"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { MetaRow } from "@/components/ui/meta-row";
import { useQueryClient } from "@tanstack/react-query";
import { useClient } from "@/lib/pm-amm-client";
import { useSwapQuote, type SwapMode } from "@/hooks/use-swap-quote";
import { useTokenInfo } from "@/hooks/use-token-info";
import { formatAmount } from "@pm-amm/sdk/math";
import type { SwapDirection } from "@pm-amm/sdk";
import { PROTOCOL_DAO } from "@pm-amm/sdk";
import type { MarketData } from "@/hooks/use-markets";
import type { UserTokens } from "@/hooks/use-user-tokens";
import { PublicKey, ComputeBudgetProgram, type TransactionInstruction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import { solscanTxUrl } from "@/lib/constants";
import { toast } from "sonner";

const SLIPPAGE_BPS = 100;

export function TradePanel({
  market,
  tokens,
  presetSide,
  presetNonce,
}: {
  market: MarketData;
  tokens: UserTokens | null;
  /** Drives the YES/NO side externally (e.g. group page "Buy YES/NO" leg buttons). */
  presetSide?: "yes" | "no";
  /** Bump to re-apply `presetSide` even when its value is unchanged (re-click). */
  presetNonce?: number;
}) {
  const [mode, setMode] = useState<SwapMode>("buy");
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);

  // External "Buy YES/NO" triggers set the side + force buy mode + clear amount.
  useEffect(() => {
    if (!presetSide) return;
    setSide(presetSide);
    setMode("buy");
    setAmount("");
  }, [presetSide, presetNonce]);

  const queryClient = useQueryClient();
  const client = useClient();
  const { publicKey } = useWallet();

  // Per-market collateral token. YES/NO mints inherit the collateral's decimals,
  // so a SINGLE `decimals` (and `ONE`) governs every amount in this market.
  const tok = useTokenInfo(market.collateralMint);
  const decimals = tok.data?.decimals ?? 6;
  const symbol = tok.data?.symbol ?? "USDC";
  const ONE = 10 ** decimals;

  const amountNum = parseFloat(amount) || 0;
  const maxSellable = side === "yes" ? (tokens?.yes ?? 0) : (tokens?.no ?? 0);
  const sellExceeds = mode === "sell" && amountNum * ONE > maxSellable;
  // Raw base units. Collateral, YES and NO all share `decimals`, so this holds
  // for buy (collateral in) and sell (YES/NO in) alike.
  const rawAmount = Math.floor(amountNum * ONE);

  const { data: quote, isLoading: quoteLoading } = useSwapQuote(
    market.publicKey,
    side,
    mode,
    sellExceeds ? 0 : rawAmount,
    { reserveYes: market.reserveYes, reserveNo: market.reserveNo, lEff: market.lEff },
    market.collateralMint,
  );

  const minOutput = quote?.output ? Math.floor(quote.output * (1 - SLIPPAGE_BPS / 10000)) : 0;

  const handleTrade = async () => {
    if (!client || !publicKey || !amount || !quote?.output) return;
    setLoading(true);
    try {
      const marketPda = new PublicKey(market.publicKey);
      const collatMint = new PublicKey(market.collateralMint);
      const yesMintPda = client.yesMint(marketPda);
      const noMintPda = client.noMint(marketPda);
      const userCollateral = await getAssociatedTokenAddress(collatMint, publicKey);
      const userYes = await getAssociatedTokenAddress(yesMintPda, publicKey);
      const userNo = await getAssociatedTokenAddress(noMintPda, publicKey);

      // Build ATA creation instructions (if needed) to bundle atomically
      const conn = client.connection;
      const preIxs: TransactionInstruction[] = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ];
      const atasCreated: { ata: PublicKey; mint: PublicKey }[] = [];
      for (const [ata, mint] of [
        [userYes, yesMintPda],
        [userNo, noMintPda],
        [userCollateral, collatMint],
      ] as [PublicKey, PublicKey][]) {
        try {
          await getAccount(conn, ata);
        } catch {
          preIxs.push(createAssociatedTokenAccountInstruction(publicKey, ata, publicKey, mint));
          atasCreated.push({ ata, mint });
        }
      }

      // Fee-recipient ATAs (2% swap fee → 50% DAO, 50% creator) in the market's
      // collateral. The DAO key is off-curve. The creator ATA is only needed when
      // the trader is NOT the creator (else creatorUsdc is null on-chain).
      const creatorAuthority = new PublicKey(market.authority);
      const daoAta = await getAssociatedTokenAddress(collatMint, PROTOCOL_DAO, true);
      try {
        await getAccount(conn, daoAta);
      } catch {
        preIxs.push(
          createAssociatedTokenAccountInstruction(publicKey, daoAta, PROTOCOL_DAO, collatMint),
        );
      }
      if (!creatorAuthority.equals(publicKey)) {
        const creatorAta = await getAssociatedTokenAddress(collatMint, creatorAuthority, true);
        try {
          await getAccount(conn, creatorAta);
        } catch {
          preIxs.push(
            createAssociatedTokenAccountInstruction(
              publicKey,
              creatorAta,
              creatorAuthority,
              collatMint,
            ),
          );
        }
      }

      const direction: SwapDirection =
        mode === "buy"
          ? side === "yes"
            ? "usdcToYes"
            : "usdcToNo"
          : side === "yes"
            ? "yesToUsdc"
            : "noToUsdc";
      const lamports = Math.floor(amountNum * ONE);

      // Close ATAs that remain empty after swap (cleanup wallet, recover rent)
      // Buy YES → NO ATA empty; Buy NO → YES ATA empty
      // Sell YES → YES ATA may be empty (if sold all); NO ATA empty if just created
      const postIxs: TransactionInstruction[] = [];
      const emptyAta = side === "yes" ? userNo : userYes;
      const wasCreated = atasCreated.some((a) => a.ata.equals(emptyAta));
      if (wasCreated) {
        postIxs.push(createCloseAccountInstruction(emptyAta, publicKey, publicKey));
      }

      // Build the swap ix via the SDK, then compose our own tx so the pre/post
      // ATA create + close-empty behavior is preserved.
      const swapIx = await client.ix.swap({
        signer: publicKey,
        market: marketPda,
        direction,
        amountIn: lamports,
        minOutput,
        creatorAuthority,
        collateralMint: collatMint,
      });
      const tx = await client.sendIxs([...preIxs, swapIx, ...postIxs]);

      // Refetch markets to get post-trade price, then snap it
      const data = await queryClient.fetchQuery({ queryKey: ["markets"], staleTime: 0 });
      const updated = (data as MarketData[])?.find((m) => m.publicKey === market.publicKey);
      if (updated?.price) {
        fetch("/api/price-snap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            marketId: market.publicKey,
            price: updated.price,
            timestamp: Math.floor(Date.now() / 1000),
            force: true,
          }),
        }).catch(console.error);
      }

      const desc =
        mode === "buy"
          ? `${formatAmount(quote.output, decimals)} ${side.toUpperCase()} for ${amountNum} ${symbol}`
          : `${amountNum} ${side.toUpperCase()} for ${formatAmount(quote.output, decimals)} ${symbol}`;
      toast.success(`${mode === "buy" ? "Bought" : "Sold"} ${side.toUpperCase()}`, {
        description: desc,
        action: { label: "Solscan ↗", onClick: () => window.open(solscanTxUrl(tx), "_blank") },
      });
      setAmount("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("WalletSign") || msg.includes("User rejected")) {
        toast.info("Transaction cancelled");
        setLoading(false);
        return;
      }
      if (msg.includes("Slippage")) {
        toast.error("Slippage exceeded", { description: "Price moved. Try again." });
      } else {
        toast.error("Transaction failed", { description: msg.slice(0, 120) });
      }
    } finally {
      setLoading(false);
    }
  };

  const outputDisplay = quote?.output ? formatAmount(quote.output, decimals) : "—";
  // Buy: pay collateral, receive YES/NO. Sell: pay YES/NO, receive collateral.
  const inputUnit = mode === "buy" ? symbol : side.toUpperCase();
  const outputUnit = mode === "buy" ? side.toUpperCase() : symbol;

  return (
    <div className="border border-line p-[16px] space-y-[12px]">
      <div className="text-caption">TRADE</div>

      {/* Mode toggle */}
      <div className="flex gap-[8px]">
        <Button
          variant={mode === "buy" ? "secondary" : "ghost"}
          onClick={() => {
            setMode("buy");
            setAmount("");
          }}
          className="flex-1 uppercase text-[11px] tracking-[0.05em]"
        >
          Buy
        </Button>
        <Button
          variant={mode === "sell" ? "secondary" : "ghost"}
          onClick={() => {
            setMode("sell");
            setAmount("");
          }}
          className="flex-1 uppercase text-[11px] tracking-[0.05em]"
        >
          Sell
        </Button>
      </div>

      {/* Side toggle */}
      <div className="flex gap-[6px]">
        <Button
          variant={side === "yes" ? "yes" : "ghost"}
          onClick={() => {
            setSide("yes");
            setAmount("");
          }}
          className="flex-1"
        >
          YES
        </Button>
        <Button
          variant={side === "no" ? "no" : "ghost"}
          onClick={() => {
            setSide("no");
            setAmount("");
          }}
          className="flex-1"
        >
          NO
        </Button>
      </div>

      {/* Amount */}
      <AmountInput
        label={mode === "buy" ? "YOU PAY" : "YOU SELL"}
        unit={inputUnit}
        type="number"
        placeholder="0.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        min="0"
        step="0.01"
      />
      {mode === "sell" && maxSellable > 0 && (
        <button
          type="button"
          className="text-[11px] text-accent hover:text-text-hi font-mono transition-all duration-[120ms]"
          onClick={() => setAmount((maxSellable / ONE).toString())}
        >
          Max: {formatAmount(maxSellable, decimals)} {side.toUpperCase()}
        </button>
      )}

      {/* Quote */}
      {sellExceeds && <p className="text-no text-[11px] font-mono">Insufficient balance</p>}
      {amountNum > 0 && !sellExceeds && (
        <div className="border-t border-line pt-[8px]">
          {quoteLoading ? (
            <p className="text-muted text-[12px] font-mono">Fetching quote...</p>
          ) : quote?.error ? (
            <p className="text-no text-[11px] font-mono">
              {quote.error.includes("ProgramFailedToComplete")
                ? "Exceeds on-chain compute limit — reduce amount"
                : quote.error.includes("AccountNotInitialized")
                  ? "Token account missing — first buy will create it"
                  : quote.error.includes("InsufficientFunds") || quote.error.includes("0x1")
                    ? "Insufficient balance"
                    : quote.error}
            </p>
          ) : quote?.output ? (
            <>
              {(() => {
                const avgP =
                  mode === "buy"
                    ? (amountNum * ONE) / quote.output
                    : quote.output / (amountNum * ONE);
                const fairP =
                  mode === "buy"
                    ? side === "yes"
                      ? market.price
                      : 1 - market.price
                    : side === "yes"
                      ? market.price
                      : 1 - market.price;
                const slippage = fairP > 0 ? (Math.abs(avgP - fairP) / fairP) * 100 : 0;

                // Potential profit if this side wins.
                const cost = amountNum * ONE; // collateral paid
                const tokensReceived = quote.output; // tokens you get
                // If this side wins: each winning token = 1 collateral. Profit = tokens - cost.
                const potentialProfit = mode === "buy" ? tokensReceived - cost : 0;
                const profitPct = cost > 0 && mode === "buy" ? (potentialProfit / cost) * 100 : 0;

                return (
                  <>
                    <MetaRow label="You receive" value={`${outputDisplay} ${outputUnit}`} />
                    <MetaRow
                      label="Avg price"
                      value={`${avgP.toFixed(4)} ${symbol}/${side.toUpperCase()}`}
                    />
                    {mode === "buy" && tokensReceived > 0 && (
                      <MetaRow
                        label={`If ${side.toUpperCase()} wins`}
                        value={
                          <span className="text-yes">
                            {formatAmount(tokensReceived, decimals, { symbol })} (+
                            {profitPct.toFixed(0)}%)
                          </span>
                        }
                      />
                    )}
                    <MetaRow label="Slippage" value={`${slippage.toFixed(1)}%`} />
                    {slippage > 5 && (
                      <div className="text-[11px] font-mono py-[6px] px-[8px] mt-[4px] border rounded-sm border-[color-mix(in_oklch,var(--no)_40%,transparent)] bg-[color-mix(in_oklch,var(--no)_8%,transparent)] text-no">
                        {slippage > 20 ? "⚠ Extreme slippage" : "⚠ High slippage"} — you are moving
                        the price significantly
                      </div>
                    )}
                    <MetaRow
                      label="Min output (1%)"
                      value={`${formatAmount(minOutput, decimals)} ${outputUnit}`}
                      last
                    />
                  </>
                );
              })()}
            </>
          ) : null}
        </div>
      )}

      {/* Execute */}
      <Button
        variant={side === "yes" ? "yes" : "no"}
        className="w-full uppercase text-[11px] tracking-[0.05em]"
        onClick={handleTrade}
        disabled={
          !publicKey || !amount || loading || market.resolved || !quote?.output || sellExceeds
        }
      >
        {loading ? "TRADING..." : `${mode.toUpperCase()} ${side.toUpperCase()}`}
      </Button>
    </div>
  );
}
