"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { Figure } from "@/components/ui/figure";
import { MetaRow } from "@/components/ui/meta-row";
import { useClient } from "@/lib/pm-amm-client";
import { usePositionValue } from "@/hooks/use-position-value";
import { formatUsdc } from "@pm-amm/sdk/math";
import type { MarketData } from "@/hooks/use-markets";
import type { UserTokens } from "@/hooks/use-user-tokens";
import { solscanTxUrl } from "@/lib/constants";
import { toast } from "sonner";

export function PositionCard({
  market,
  tokens,
}: {
  market: MarketData;
  tokens: UserTokens | null;
}) {
  const [loading, setLoading] = useState(false);
  const client = useClient();
  const { publicKey } = useWallet();
  const { data: posValue, isLoading: valueLoading } = usePositionValue(market.publicKey, tokens);

  if (!publicKey) return null;

  const yesAmount = tokens?.yes ?? 0;
  const noAmount = tokens?.no ?? 0;
  const usdcBalance = tokens?.usdc ?? 0;
  const hasPosition = yesAmount > 0 || noAmount > 0;
  const redeemable = Math.min(yesAmount, noAmount);
  const winningSide = market.winningSide;
  const winningBalance = winningSide === 1 ? yesAmount : winningSide === 2 ? noAmount : 0;
  const losingBalance = winningSide === 1 ? noAmount : winningSide === 2 ? yesAmount : 0;

  const handleRedeem = async () => {
    if (!client || !publicKey || redeemable <= 0) return;
    setLoading(true);
    try {
      // redeemable is in raw 6-dp micro-units (min of YES/NO balances).
      const tx = await client.send.redeemPair(new PublicKey(market.publicKey), redeemable);
      toast.success(`Redeemed ${formatUsdc(redeemable)} USDC`, {
        action: { label: "Solscan ↗", onClick: () => window.open(solscanTxUrl(tx), "_blank") },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("WalletSign") || msg.includes("User rejected")) {
        toast.info("Transaction cancelled");
        setLoading(false);
        return;
      }
      toast.error("Redeem failed", { description: msg.slice(0, 120) });
    } finally {
      setLoading(false);
    }
  };

  const handleClaimWinnings = async () => {
    if (!client || !publicKey || !hasPosition) return;
    setLoading(true);
    try {
      // send.claimWinnings ensures YES/NO/USDC ATAs + CU; settles everything on-chain.
      const tx = await client.send.claimWinnings(new PublicKey(market.publicKey));
      const payout = winningBalance > 0 ? formatUsdc(winningBalance) : "0";
      const burned = losingBalance > 0 ? formatUsdc(losingBalance) : "0";
      toast.success(
        winningBalance > 0
          ? `Claimed ${payout} USDC + burned ${burned} losing tokens`
          : `Burned ${burned} losing tokens`,
        { action: { label: "Solscan ↗", onClick: () => window.open(solscanTxUrl(tx), "_blank") } },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("WalletSign") || msg.includes("User rejected")) {
        toast.info("Transaction cancelled");
      } else {
        toast.error("Settle failed", { description: msg.slice(0, 120) });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-line p-[16px] space-y-[12px]">
      <div className="text-caption">YOUR POSITION</div>

      <MetaRow label="USDC Balance" value={`${formatUsdc(usdcBalance)} USDC`} last={!hasPosition} />

      {market.resolved ? (
        /* === RESOLVED === */
        hasPosition ? (
          <div className="space-y-[12px]">
            <div className="flex gap-[32px]">
              <Figure label="YES" value={formatUsdc(yesAmount)} size="data" color="yes" />
              <Figure label="NO" value={formatUsdc(noAmount)} size="data" color="no" />
            </div>

            {winningBalance > 0 && (
              <MetaRow label="Payout" value={`${formatUsdc(winningBalance)} USDC`} last />
            )}

            <Button
              variant={winningSide === 1 ? "yes" : "no"}
              className="w-full"
              onClick={handleClaimWinnings}
              disabled={loading}
            >
              {loading
                ? "SETTLING..."
                : winningBalance > 0
                  ? `Settle — ${formatUsdc(winningBalance)} USDC`
                  : "Settle — clean up tokens"}
            </Button>
          </div>
        ) : (
          <p className="text-muted text-[12px] font-mono">No position in this market.</p>
        )
      ) : /* === ACTIVE === */
      hasPosition ? (
        <>
          <div className="flex gap-[32px]">
            <Figure label="YES" value={formatUsdc(yesAmount)} size="data" color="yes" />
            <Figure label="NO" value={formatUsdc(noAmount)} size="data" color="no" />
          </div>

          <div className="border-t border-line pt-[8px]">
            {valueLoading ? (
              <p className="text-muted text-[12px] font-mono">Calculating...</p>
            ) : posValue?.error ? (
              <p className="text-no text-[11px] font-mono">{posValue.error}</p>
            ) : posValue ? (
              <>
                {yesAmount > 0 && (
                  <MetaRow label="YES → USDC" value={formatUsdc(posValue.yesValueUsdc)} />
                )}
                {noAmount > 0 && (
                  <MetaRow label="NO → USDC" value={formatUsdc(posValue.noValueUsdc)} />
                )}
                <MetaRow label="Sell now" value={`${formatUsdc(posValue.totalUsdc)} USDC`} />
                {yesAmount > 0 && (
                  <MetaRow
                    label="If YES wins"
                    value={<span className="text-yes">+{formatUsdc(yesAmount)} USDC</span>}
                  />
                )}
                {noAmount > 0 && (
                  <MetaRow
                    label="If NO wins"
                    value={<span className="text-no">+{formatUsdc(noAmount)} USDC</span>}
                    last
                  />
                )}
                {yesAmount > 0 && noAmount === 0 && (
                  <MetaRow label="If NO wins" value={<span className="text-no">$0.00</span>} last />
                )}
                {noAmount > 0 && yesAmount === 0 && (
                  <MetaRow
                    label="If YES wins"
                    value={<span className="text-no">$0.00</span>}
                    last
                  />
                )}
              </>
            ) : null}
          </div>

          {redeemable > 0 && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={handleRedeem}
              disabled={loading}
            >
              Redeem {formatUsdc(redeemable)} pairs
            </Button>
          )}
        </>
      ) : (
        <p className="text-muted text-[12px] font-mono">
          No YES/NO tokens. Trade to open a position.
        </p>
      )}
    </div>
  );
}
