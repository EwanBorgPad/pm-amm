"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { StatusBar } from "@/components/layout/status-bar";
import { Button } from "@/components/ui/button";
import { useProgram } from "@/hooks/use-program";
import { runCreateVault } from "@/lib/vault";
import { runCreateVaultGroup } from "@/lib/vault_group";
import { solscanTxUrl } from "@/lib/constants";
import { toast } from "sonner";
import Link from "next/link";

type Kind = "binary" | "group";

export default function CreateVaultPage() {
  const [kind, setKind] = useState<Kind>("binary");
  const [name, setName] = useState("");
  const [legNames, setLegNames] = useState<string[]>(["", "", ""]);
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

  const addLeg = () => {
    if (legNames.length >= 8) return;
    setLegNames([...legNames, ""]);
  };
  const removeLeg = (i: number) => {
    if (legNames.length <= 2) return;
    setLegNames(legNames.filter((_, idx) => idx !== i));
  };
  const setLegAt = (i: number, v: string) => {
    setLegNames(legNames.map((ln, idx) => (idx === i ? v : ln)));
  };

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
      if (kind === "binary") {
        const result = await runCreateVault(program, publicKey, {
          name: name.trim(),
          commitDurationSecs: commitSecs,
          marketDurationSecs: marketSecs,
          minTotalUsdc: minTotalNum,
        });
        toast.success(`Vault ${result.vaultId} opened`);
        router.push(`/vault/${result.vaultId}`);
      } else {
        const cleanLegs = legNames.map((l) => l.trim()).filter(Boolean);
        if (cleanLegs.length < 2 || cleanLegs.length > 8) {
          toast.error("Provide 2 to 8 leg names");
          setLoading(false);
          return;
        }
        const result = await runCreateVaultGroup(program, publicKey, {
          name: name.trim(),
          legNames: cleanLegs,
          commitDurationSecs: commitSecs,
          marketDurationSecs: marketSecs,
          minTotalUsdc: minTotalNum,
        });
        toast.success(`Multi-outcome vault ${result.vaultId} opened`);
        router.push(`/vault-group/${result.vaultId}`);
      }
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
          The crowd commits USDC during the commit phase. After it ends, anyone permissionlessly
          launches the underlying market(s) at the crowd-implied price. No designated market maker.
        </p>

        {/* Kind selector */}
        <div className="flex gap-[8px] mb-[24px]">
          <Button variant={kind === "binary" ? "yes" : "ghost"} onClick={() => setKind("binary")}>
            Binary (YES/NO)
          </Button>
          <Button variant={kind === "group" ? "yes" : "ghost"} onClick={() => setKind("group")}>
            Multi-outcome (2–8 legs)
          </Button>
        </div>

        <div className="space-y-[16px]">
          <Field
            label="Question / Name"
            placeholder={
              kind === "binary" ? "Will BTC hit $200k by EoY?" : "Who wins the 2028 US Election?"
            }
            value={name}
            onChange={setName}
          />

          {kind === "group" && (
            <div>
              <label className="text-[11px] text-muted font-mono uppercase mb-[4px] block">
                Outcomes (2–8)
              </label>
              <div className="space-y-[8px]">
                {legNames.map((ln, i) => (
                  <div key={i} className="flex gap-[8px]">
                    <input
                      value={ln}
                      onChange={(e) => setLegAt(i, e.target.value)}
                      placeholder={`Outcome ${i + 1}`}
                      maxLength={32}
                      className="flex-1 bg-transparent border border-border rounded px-[12px] py-[8px] text-[14px] text-text-hi outline-none focus:border-text-hi"
                    />
                    {legNames.length > 2 && (
                      <Button variant="ghost" onClick={() => removeLeg(i)}>
                        −
                      </Button>
                    )}
                  </div>
                ))}
                {legNames.length < 8 && (
                  <Button variant="ghost" onClick={addLeg}>
                    + add outcome
                  </Button>
                )}
              </div>
            </div>
          )}

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
          <p className="text-[12px] font-mono">
            {kind === "binary"
              ? "Binary YES/NO market"
              : `Multi-outcome with ${legNames.filter((l) => l.trim()).length || legNames.length} legs`}
          </p>
          <p className="text-[12px] font-mono">Commit closes in {commitMinutes} min</p>
          <p className="text-[12px] font-mono">Market expires {marketHours}h after launch</p>
          <p className="text-[12px] font-mono">
            Launch requires ≥ {minTotalNum} USDC committed in total
            {kind === "group" && ", and each leg ≥ 1% share"}
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
