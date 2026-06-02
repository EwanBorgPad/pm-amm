"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/pm-amm-client";
import { useLpPosition } from "@/hooks/use-lp-position";
import type { MarketData } from "@/hooks/use-markets";
import { solscanTxUrl } from "@/lib/constants";
import { toast } from "sonner";

export function ResidualsWidget({ market }: { market: MarketData }) {
  const [loading, setLoading] = useState(false);
  const client = useClient();
  const { publicKey } = useWallet();
  const { data: lp } = useLpPosition(market.publicKey);

  if (!lp || lp.shares <= 0) return null;

  const handleClaim = async () => {
    if (!client || !publicKey) return;
    setLoading(true);
    try {
      // The SDK send helper ensures YES/NO ATAs exist + sets the compute budget.
      const tx = await client.send.claimLpResiduals(new PublicKey(market.publicKey));
      toast.success("Claimed YES+NO residuals", {
        action: { label: "Solscan ↗", onClick: () => window.open(solscanTxUrl(tx), "_blank") },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("WalletSign") || msg.includes("User rejected")) {
        toast.info("Transaction cancelled");
        setLoading(false);
        return;
      }
      if (msg.includes("NoResidualsToClaim")) {
        toast.info("No residuals to claim yet.");
      } else {
        toast.error("Claim failed", { description: msg.slice(0, 120) });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-line border-l-accent border-l-2 p-[16px] space-y-[12px]">
      <div className="text-caption">LP RESIDUALS · dC_t</div>
      <p className="text-[12px] text-text-dim leading-[1.5]">
        As the market approaches expiry, YES+NO tokens are released to LPs.
      </p>
      <Button
        variant="secondary"
        className="w-full"
        onClick={handleClaim}
        disabled={loading || !publicKey}
      >
        {loading ? "Claiming..." : "Claim Residuals"}
      </Button>
    </div>
  );
}
