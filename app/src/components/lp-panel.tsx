"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { MetaRow } from "@/components/ui/meta-row";
import { useClient } from "@/lib/pm-amm-client";
import { useLpPosition } from "@/hooks/use-lp-position";
import { useTokenInfo } from "@/hooks/use-token-info";
import { formatAmount } from "@pm-amm/sdk/math";
import type { MarketData } from "@/hooks/use-markets";
import { solscanTxUrl } from "@/lib/constants";
import { toast } from "sonner";

export function LpPanel({ market }: { market: MarketData }) {
  const [depositAmt, setDepositAmt] = useState("");
  const [loading, setLoading] = useState(false);
  const client = useClient();
  const { publicKey } = useWallet();
  const { data: lp } = useLpPosition(market.publicKey);
  const tok = useTokenInfo(market.collateralMint);
  const decimals = tok.data?.decimals ?? 6;
  const symbol = tok.data?.symbol ?? "USDC";

  const marketPda = new PublicKey(market.publicKey);

  const handleDeposit = async () => {
    if (!client || !publicKey || !depositAmt) return;
    setLoading(true);
    try {
      // send.depositLiquidity takes human collateral, ensures the ATA, sets CU.
      const tx = await client.send.depositLiquidity(marketPda, parseFloat(depositAmt));
      toast.success(`Deposited ${depositAmt} ${symbol}`, {
        action: { label: "Solscan ↗", onClick: () => window.open(solscanTxUrl(tx), "_blank") },
      });
      setDepositAmt("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("WalletSign") || msg.includes("User rejected")) {
        toast.info("Transaction cancelled");
        setLoading(false);
        return;
      }
      toast.error("Deposit failed", { description: msg.slice(0, 120) });
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!client || !publicKey || !lp) return;
    setLoading(true);
    try {
      // Burn the EXACT on-chain shares (raw Q64.64 bits). Reconstructing from
      // the float `lp.shares` can round above the stored value → the on-chain
      // `burn_shares <= lp.shares` check fails with InsufficientLiquidity.
      const sharesBn = new BN(lp.sharesRaw);
      const tx = await client.send.withdrawLiquidity(marketPda, sharesBn);
      toast.success("Withdrew all liquidity", {
        action: { label: "Solscan ↗", onClick: () => window.open(solscanTxUrl(tx), "_blank") },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("WalletSign") || msg.includes("User rejected")) {
        toast.info("Transaction cancelled");
        setLoading(false);
        return;
      }
      toast.error("Withdraw failed", { description: msg.slice(0, 120) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-line p-[16px] space-y-[12px]">
      <div className="text-caption">LIQUIDITY</div>

      {lp && lp.shares > 0 && (
        <div className="border-b border-line pb-[8px]">
          <MetaRow label="Your shares" value={lp.shares.toFixed(2)} />
          <MetaRow
            label="Deposited"
            value={formatAmount(lp.collateralDeposited, decimals, { symbol })}
            last
          />
        </div>
      )}

      {!market.resolved && (
        <div className="flex gap-[8px]">
          <AmountInput
            placeholder="0.00"
            value={depositAmt}
            onChange={(e) => setDepositAmt(e.target.value)}
            type="number"
            min="0.001"
            step="0.01"
            className="flex-1"
          />
          <Button
            variant="secondary"
            onClick={handleDeposit}
            disabled={!publicKey || !depositAmt || loading}
            className="shrink-0"
          >
            {loading ? "..." : "Deposit"}
          </Button>
        </div>
      )}

      {lp && lp.shares > 0 && (
        <Button variant="secondary" className="w-full" onClick={handleWithdraw} disabled={loading}>
          Withdraw All
        </Button>
      )}
    </div>
  );
}
