"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { StatusBar } from "@/components/layout/status-bar";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { MetaRow } from "@/components/ui/meta-row";
import { useProgram } from "@/hooks/use-program";
import { useWallet } from "@solana/wallet-adapter-react";
import { runCreateGroup, type GroupCreateInput } from "@/lib/create-group";

const MIN_LEGS = 2;
const MAX_LEGS = 32;

export default function CreateGroupPage() {
  const [name, setName] = useState("");
  const [legCount, setLegCount] = useState(5);
  const [legNames, setLegNames] = useState<string[]>(
    Array.from({ length: 5 }, (_, i) => `Outcome ${i + 1}`),
  );
  const [durationValue, setDurationValue] = useState("60");
  const [durationUnit, setDurationUnit] = useState<"min" | "hours" | "days">("min");
  const [budgetPerLeg, setBudgetPerLeg] = useState("50");

  const [step, setStep] = useState<{ label: string; index: number } | null>(null);

  const program = useProgram();
  const { publicKey } = useWallet();
  const router = useRouter();

  const durSecs =
    parseFloat(durationValue || "0") *
    (durationUnit === "min" ? 60 : durationUnit === "hours" ? 3600 : 86400);
  const budget = parseFloat(budgetPerLeg || "0");
  const totalBudget = budget * legCount;
  const seedBps = Math.floor(10_000 / legCount);
  const sumBps = seedBps * legCount;

  const onLegCountChange = (n: number) => {
    const clamped = Math.max(MIN_LEGS, Math.min(MAX_LEGS, n));
    setLegCount(clamped);
    setLegNames((prev) => {
      const next = [...prev];
      while (next.length < clamped) next.push(`Outcome ${next.length + 1}`);
      next.length = clamped;
      return next;
    });
  };

  const onSubmit = async () => {
    if (!program || !publicKey) return;
    if (!name.trim()) return toast.error("Group name required");
    if (durSecs < 360) return toast.error("Duration too short (min 6 min)");
    if (budget < 0.01) return toast.error("Budget per leg too small");

    const input: GroupCreateInput = {
      name: name.trim(),
      legCount,
      legNames,
      durationSecs: Math.floor(durSecs),
      budgetPerLegUsdc: budget,
    };

    try {
      const result = await runCreateGroup({
        program,
        wallet: publicKey,
        input,
        onProgress: (label, index) => setStep({ label, index }),
      });
      setStep(null);
      toast.success(`Group #${result.groupId} created`, {
        description: `${legCount} legs at ${(seedBps / 100).toFixed(2)}% each`,
        action: {
          label: "Open ↗",
          onClick: () => router.push(`/group/${result.groupId}`),
        },
      });
      router.push(`/group/${result.groupId}`);
    } catch (err) {
      setStep(null);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("WalletSign") || msg.includes("User rejected")) {
        toast.info("Transaction cancelled");
        return;
      }
      toast.error("Group creation failed", { description: msg.slice(0, 200) });
    }
  };

  // Steps: up to 1 USDC ATA (if missing) + 1 group + N legs. ATA step is
  // conditional, so totalSteps is the worst case.
  const totalSteps = 2 + legCount;

  return (
    <>
      <StatusBar />
      <main className="flex-1 max-w-3xl mx-auto w-full px-[48px] py-[32px]">
        <Link
          href="/create"
          className="text-[12px] text-muted hover:text-text-hi transition-all duration-[120ms] mb-[16px] block font-mono tracking-[0.03em]"
        >
          ← BACK TO CREATE
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-[16px]">
          <div className="border border-line p-[24px] space-y-[16px]">
            <div className="text-caption">CREATE GROUP MARKET</div>

            <div>
              <div className="text-caption mb-[8px]">QUESTION</div>
              <div className="border border-line-2 rounded-lg px-[12px] focus-within:border-muted transition-all duration-[120ms]">
                <input
                  className="bg-transparent border-none outline-none text-text-hi text-[14px] py-[10px] w-full"
                  placeholder="Who wins the Grand Prix?"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={64}
                />
              </div>
            </div>

            <div>
              <div className="text-caption mb-[8px]">LEG COUNT (N)</div>
              <input
                type="number"
                min={MIN_LEGS}
                max={MAX_LEGS}
                value={legCount}
                onChange={(e) => onLegCountChange(parseInt(e.target.value || "2", 10))}
                className="bg-transparent border border-line-2 rounded-lg outline-none text-text-hi text-[14px] py-[8px] px-[12px] w-[80px] focus:border-muted"
              />
              <span className="ml-[8px] text-[11px] text-muted font-mono">
                {MIN_LEGS}..{MAX_LEGS}
              </span>
            </div>

            <div>
              <div className="text-caption mb-[8px]">LEG NAMES</div>
              <div className="space-y-[4px] max-h-[200px] overflow-y-auto">
                {legNames.map((n, i) => (
                  <div
                    key={i}
                    className="flex gap-[8px] items-center border border-line rounded-lg px-[8px]"
                  >
                    <span className="text-[10px] font-mono text-muted tabular-nums w-[20px]">
                      {i}
                    </span>
                    <input
                      className="bg-transparent border-none outline-none text-text-hi text-[12px] py-[6px] flex-1 font-mono"
                      value={n}
                      onChange={(e) => {
                        const next = [...legNames];
                        next[i] = e.target.value.slice(0, 60);
                        setLegNames(next);
                      }}
                      placeholder={`Outcome ${i + 1}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-[8px]">
              <AmountInput
                label="DURATION"
                unit={durationUnit.toUpperCase()}
                type="number"
                placeholder="60"
                value={durationValue}
                onChange={(e) => setDurationValue(e.target.value)}
                min="1"
                step="1"
              />
              <AmountInput
                label="BUDGET / LEG"
                unit="USDC"
                type="number"
                placeholder="50"
                value={budgetPerLeg}
                onChange={(e) => setBudgetPerLeg(e.target.value)}
                min="1"
                step="1"
              />
            </div>

            <div className="flex gap-[4px]">
              {(["min", "hours", "days"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setDurationUnit(u)}
                  className={`px-[8px] py-[3px] rounded-sm text-[10px] font-mono uppercase tracking-[0.05em] border cursor-pointer transition-all duration-[120ms] ${
                    durationUnit === u
                      ? "text-text-hi border-line-2 bg-surface"
                      : "text-muted border-transparent"
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>

            <Button
              variant="secondary"
              className="w-full"
              onClick={onSubmit}
              disabled={!publicKey || !name || step !== null}
            >
              {step
                ? `${step.label} (${step.index}/${totalSteps})`
                : `Create ${legCount}-leg group`}
            </Button>

            {step && (
              <div className="w-full h-[2px] bg-line">
                <div
                  className="h-full bg-yes transition-all duration-[300ms]"
                  style={{ width: `${(step.index / totalSteps) * 100}%` }}
                />
              </div>
            )}

            {!publicKey && (
              <p className="text-[11px] text-muted font-mono text-center">
                Connect wallet to create.
              </p>
            )}
          </div>

          <div className="border border-line p-[16px] space-y-[10px] h-fit">
            <div className="text-caption">PREVIEW</div>
            <MetaRow label="Legs" value={`${legCount}`} />
            <MetaRow label="Seed price / leg" value={`${(seedBps / 100).toFixed(2)}%`} />
            <MetaRow label="Σ p_i at open" value={`${(sumBps / 10_000).toFixed(4)}`} />
            {sumBps < 10_000 && (
              <MetaRow label="Residual" value={`${10_000 - sumBps} bps (absorbed off-chain)`} />
            )}
            <MetaRow label="Total liquidity" value={`${totalBudget.toFixed(2)} USDC`} />
            <MetaRow label="Transactions" value={`${totalSteps} (1 + 3×N)`} last />

            <p className="text-[10px] text-muted/60 font-mono pt-[8px] border-t border-line">
              Each leg is a binary pm-AMM market seeded at 100/N%. Σ p_i ≈ 1 at open. Drift between
              trades must be defended off-chain (or via the future on-chain dispatcher).
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
