"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { StatusBar } from "@/components/layout/status-bar";
import { Button } from "@/components/ui/button";
import { useProgram } from "@/hooks/use-program";
import { runCreateVault } from "@/lib/vault";
import { solscanTxUrl } from "@/lib/constants";
import { toast } from "sonner";
import Link from "next/link";

export default function CreateVaultPage() {
  const [name, setName] = useState("");
  const [commitMinutes, setCommitMinutes] = useState("10");
  const [marketHours, setMarketHours] = useState("24");
  const [minTotal, setMinTotal] = useState("10");
  const [loading, setLoading] = useState(false);

  const program = useProgram();
  const { publicKey } = useWallet();
  const router = useRouter();

  const commitSecs = Math.max(60, Math.floor(parseFloat(commitMinutes || "0") * 60));
  const marketSecs = Math.max(300, Math.floor(parseFloat(marketHours || "0") * 3600));
  const minTotalNum = Math.max(0.01, parseFloat(minTotal || "0") || 10);

  const handleCreate = async () => {
    if (!program || !publicKey) {
      toast.error("Connect your wallet first");
      return;
    }
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setLoading(true);
    try {
      const result = await runCreateVault(program, publicKey, {
        name: name.trim(),
        commitDurationSecs: commitSecs,
        marketDurationSecs: marketSecs,
        minTotalUsdc: minTotalNum,
      });
      toast.success(`Vault ${result.vaultId} opened`, {
        description: `Commit phase: ${commitMinutes} min`,
        action: { label: "Open ↗", onClick: () => router.push(`/vault/${result.vaultId}`) },
      });
      router.push(`/vault/${result.vaultId}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.slice(0, 200));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <StatusBar />
      <main className="flex-1 max-w-3xl mx-auto w-full px-[24px] py-[32px]">
        <Link
          href="/"
          className="text-[12px] text-muted hover:text-text-hi mb-[16px] block font-mono"
        >
          ← BACK
        </Link>
        <h2 className="text-title mb-[8px]">Open a Commitment Vault</h2>
        <p className="text-[12px] text-muted mb-[24px] font-mono">
          The crowd commits USDC on YES/NO during the commit phase. After it ends, anyone can
          permissionlessly launch a pm-AMM market with the crowd's USDC as initial liquidity,
          calibrated at the price implied by the commit ratio. No designated market maker, no
          initial price oracle.
        </p>

        <div className="space-y-[16px]">
          <Field
            label="Question / Name"
            placeholder="Will BTC hit $200k by EoY?"
            value={name}
            onChange={setName}
          />
          <Field
            label="Commit duration (minutes)"
            placeholder="10"
            value={commitMinutes}
            onChange={setCommitMinutes}
            type="number"
            min="1"
            max="10080"
          />
          <Field
            label="Market duration after launch (hours)"
            placeholder="24"
            value={marketHours}
            onChange={setMarketHours}
            type="number"
            min="0.1"
            max="720"
          />
          <Field
            label="Min total to launch (USDC)"
            placeholder="10"
            value={minTotal}
            onChange={setMinTotal}
            type="number"
            min="0.01"
          />
        </div>

        <div className="mt-[24px] p-[16px] border border-border rounded-md bg-[var(--bg-2)]">
          <p className="text-[11px] text-muted font-mono uppercase mb-[8px]">Summary</p>
          <p className="text-[12px] font-mono">Commit closes in {commitMinutes} min</p>
          <p className="text-[12px] font-mono">Market expires {marketHours}h after launch</p>
          <p className="text-[12px] font-mono">
            Launch requires ≥ {minTotalNum} USDC committed in total
          </p>
        </div>

        <Button
          onClick={handleCreate}
          disabled={loading || !publicKey}
          className="w-full mt-[24px]"
        >
          {loading ? "Opening…" : "Open vault"}
        </Button>

        {!publicKey && (
          <p className="text-[11px] text-no font-mono mt-[8px]">
            Connect your wallet to open a vault.
          </p>
        )}

        <p className="text-[10px] text-muted font-mono mt-[24px]">
          Devnet — devnet program {solscanTxUrl("").split("?")[1]}
        </p>
      </main>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  min?: string;
  max?: string;
}) {
  return (
    <div>
      <label className="text-[11px] text-muted font-mono uppercase mb-[4px] block">{label}</label>
      <input
        type={type}
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent border border-border rounded px-[12px] py-[8px] text-[14px] text-text-hi outline-none focus:border-text-hi"
      />
    </div>
  );
}
