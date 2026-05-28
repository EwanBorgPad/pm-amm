"use client";

import { use, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { StatusBar } from "@/components/layout/status-bar";
import { Button } from "@/components/ui/button";
import { MetaRow } from "@/components/ui/meta-row";
import { Countdown } from "@/components/ui/countdown";
import { useProgram } from "@/hooks/use-program";
import { useMarkets } from "@/hooks/use-markets";
import { useGroups } from "@/hooks/use-groups";
import { useVaultGroup } from "@/hooks/use-vault-groups";
import {
  runVaultCommitGroup,
  runLaunchVaultGroupMarket,
  runLaunchVaultGroupLeg,
  runClaimCommitterGroup,
  runRefundCommitGroup,
} from "@/lib/vault_group";
import { solscanAccountUrl } from "@/lib/constants";
import { formatUsdc } from "@/lib/pm-math";
import { toast } from "sonner";
import Link from "next/link";

export default function VaultGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: vault, isLoading, refetch } = useVaultGroup(Number(id));
  const { data: markets } = useMarkets();
  const { data: groups = [] } = useGroups(markets);
  const program = useProgram();
  const { publicKey } = useWallet();

  /** Find the GroupMarket linked to this vault — needed to compute the
   *  groupId for the "View / trade markets" link (page route uses the
   *  numeric groupId, not the pubkey). */
  const linkedGroup = useMemo(() => {
    if (!vault?.groupMarket) return undefined;
    return groups.find((g) => g.publicKey === vault.groupMarket);
  }, [groups, vault?.groupMarket]);

  const [amount, setAmount] = useState("5");
  const [selectedLeg, setSelectedLeg] = useState(0);
  const [busy, setBusy] = useState(false);
  const [launchProgress, setLaunchProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  const handleCommit = async () => {
    if (!program || !publicKey || !vault) return;
    const num = parseFloat(amount || "0");
    if (num < 1) {
      toast.error("Minimum commit: 1 USDC");
      return;
    }
    setBusy(true);
    try {
      await runVaultCommitGroup(
        program,
        publicKey,
        new PublicKey(vault.publicKey),
        selectedLeg,
        num,
      );
      toast.success(`Committed ${num} USDC on ${vault.legs[selectedLeg].name}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.slice(0, 200));
    } finally {
      setBusy(false);
    }
  };

  /** Single-button orchestration: 1 tx for GroupMarket + N tx for legs.
   *  Skips steps already completed (idempotent — safe to retry). */
  const handleLaunchAll = async () => {
    if (!program || !publicKey || !vault) return;
    const total = 1 + vault.legCount;
    setBusy(true);
    setLaunchProgress({ done: 0, total });
    try {
      // Step 1: GroupMarket (skip if already initialized)
      let groupPubkey: PublicKey;
      if (!vault.groupMarketInitialized) {
        const r = await runLaunchVaultGroupMarket(
          program,
          publicKey,
          new PublicKey(vault.publicKey),
        );
        groupPubkey = new PublicKey(r.groupPda);
        toast.success(`GroupMarket created (${r.groupId})`);
      } else {
        groupPubkey = new PublicKey(vault.groupMarket);
      }
      setLaunchProgress({ done: 1, total });

      // Step 2: each leg in sequence. On-chain idempotency
      // (`VaultGroupLegAlreadyLaunched`) lets us safely retry — skip those.
      let done = 1;
      for (const leg of vault.legs) {
        try {
          await runLaunchVaultGroupLeg(
            program,
            publicKey,
            new PublicKey(vault.publicKey),
            groupPubkey,
            leg.index,
          );
          toast.success(`Leg ${leg.name} launched`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("VaultGroupLegAlreadyLaunched")) {
            // already done in a prior attempt — keep going
          } else {
            throw e;
          }
        }
        done += 1;
        setLaunchProgress({ done, total });
      }
      toast.success(`All ${vault.legCount} markets launched`);
      await refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.slice(0, 200));
    } finally {
      setBusy(false);
      setLaunchProgress(null);
    }
  };

  /** Per-leg claim orchestration: loop over each leg and call the per-leg
   *  claim_committer_group. Skip legs where the user has no commit (the
   *  on-chain ix returns `NoCommitFunds` which we silently swallow). */
  const handleClaim = async () => {
    if (!program || !publicKey || !vault || !linkedGroup) return;
    const groupPda = new PublicKey(vault.groupMarket);
    const vaultPda = new PublicKey(vault.publicKey);
    setBusy(true);
    let claimed = 0;
    try {
      for (let i = 0; i < linkedGroup.legCount; i++) {
        const legPk = linkedGroup.legPubkeys[i];
        if (!legPk) continue;
        const legMarketPda = new PublicKey(legPk);
        try {
          await runClaimCommitterGroup(
            program,
            publicKey,
            vaultPda,
            groupPda,
            legMarketPda,
            i,
          );
          claimed += 1;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("NoCommitFunds") || msg.includes("AlreadyClaimed")) {
            // user has no stake in this leg, or already claimed — skip
            continue;
          }
          throw e;
        }
      }
      toast.success(`Minted YES tokens for ${claimed} leg${claimed === 1 ? "" : "s"}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.slice(0, 200));
    } finally {
      setBusy(false);
    }
  };

  const handleRefund = async () => {
    if (!program || !publicKey || !vault) return;
    setBusy(true);
    try {
      await runRefundCommitGroup(program, publicKey, new PublicKey(vault.publicKey));
      toast.success("Refund successful");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.slice(0, 200));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <StatusBar />
      <main className="flex-1 max-w-3xl mx-auto w-full px-[24px] py-[32px]">
        <Link href="/" className="text-[12px] text-muted mb-[16px] block font-mono">
          ← BACK
        </Link>

        {isLoading && <p className="text-muted font-mono text-[12px]">Loading…</p>}
        {!isLoading && !vault && (
          <p className="text-no font-mono text-[12px]">Vault group #{id} not found.</p>
        )}

        {vault && (
          <>
            <div className="flex items-center gap-[12px] flex-wrap mb-[8px]">
              <h2 className="text-title">{vault.name}</h2>
              <span className="text-[10px] px-[8px] py-[2px] border border-border text-muted font-mono">
                MULTI · {vault.legCount} LEGS
              </span>
              {vault.isCommitOpen && (
                <span className="text-[10px] px-[8px] py-[2px] border border-text-hi text-text-hi font-mono">
                  COMMIT OPEN
                </span>
              )}
              {vault.isLaunchReady && (
                <span className="text-[10px] px-[8px] py-[2px] border border-yes text-yes font-mono">
                  LAUNCH READY
                  {vault.groupMarketInitialized && ` (${vault.legsLaunched}/${vault.legCount})`}
                </span>
              )}
              {vault.isMarketLive && (
                <span className="text-[10px] px-[8px] py-[2px] border border-yes text-yes font-mono">
                  LIVE
                </span>
              )}
              {vault.isClaimOpen && (
                <span className="text-[10px] px-[8px] py-[2px] border border-text-hi text-text-hi font-mono">
                  CLAIM OPEN
                </span>
              )}
              {vault.isRefundOpen && (
                <span className="text-[10px] px-[8px] py-[2px] border border-no text-no font-mono">
                  REFUND OPEN
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-[24px] mt-[24px]">
              <div className="space-y-[8px]">
                <p className="text-[11px] text-muted font-mono uppercase">Vault state</p>
                <MetaRow label="Total committed" value={`${formatUsdc(vault.total)} USDC`} />
                <MetaRow label="Committers" value={String(vault.commitCount)} />
                <MetaRow label="Min total" value={`${formatUsdc(vault.minTotal)} USDC`} />
                {vault.isCommitOpen ? (
                  <MetaRow label="Commit ends" value={<Countdown endTs={vault.commitEndTs} />} />
                ) : vault.isMarketLive ? (
                  <MetaRow label="Market ends" value={<Countdown endTs={vault.marketEndTs} />} />
                ) : (
                  <MetaRow label="Commit ended" value="—" />
                )}
                {vault.groupMarket && (
                  <MetaRow
                    label="GroupMarket"
                    value={
                      <a
                        href={solscanAccountUrl(vault.groupMarket)}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        ↗
                      </a>
                    }
                  />
                )}

                <p className="text-[11px] text-muted font-mono uppercase pt-[16px]">Legs</p>
                {vault.legs.map((leg) => (
                  <MetaRow
                    key={leg.index}
                    label={leg.name}
                    value={`${formatUsdc(leg.total)} USDC · ${(leg.shareBps / 100).toFixed(2)}%`}
                  />
                ))}
                {vault.fullyLaunched && linkedGroup && (
                  <Link
                    href={`/group/${linkedGroup.groupId}`}
                    className="block text-center text-[11px] text-yes hover:text-text-hi font-mono uppercase tracking-[0.05em] py-[8px] mt-[8px] border border-yes/40 rounded-sm transition-colors"
                  >
                    ↗ View / trade markets
                  </Link>
                )}
              </div>

              <div className="space-y-[12px]">
                {vault.isCommitOpen && (
                  <>
                    <p className="text-[11px] text-muted font-mono uppercase">Commit</p>
                    <div className="flex gap-[8px] flex-wrap">
                      {vault.legs.map((leg) => (
                        <Button
                          key={leg.index}
                          variant={selectedLeg === leg.index ? "yes" : "ghost"}
                          onClick={() => setSelectedLeg(leg.index)}
                        >
                          {leg.name || `Leg ${leg.index}`}
                        </Button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full bg-transparent border border-border rounded px-[12px] py-[8px] text-[14px] text-text-hi outline-none"
                      placeholder="Amount (USDC)"
                    />
                    <Button onClick={handleCommit} disabled={busy || !publicKey} className="w-full">
                      {busy
                        ? "…"
                        : `Commit ${amount} USDC on ${vault.legs[selectedLeg]?.name || "—"}`}
                    </Button>
                  </>
                )}

                {vault.isLaunchReady && (
                  <>
                    <p className="text-[11px] text-muted font-mono uppercase">
                      Launch (permissionless)
                    </p>
                    <p className="text-[11px] text-muted">
                      Anyone can launch — this sends{" "}
                      <strong className="text-text-hi">{1 + vault.legCount} transactions</strong>{" "}
                      back-to-back: 1 to create the GroupMarket, then 1 per leg. Each leg market
                      starts at the crowd-implied price (its commit share).
                    </p>
                    <Button
                      onClick={handleLaunchAll}
                      disabled={busy || !publicKey}
                      className="w-full"
                    >
                      {busy && launchProgress
                        ? `Launching… (${launchProgress.done}/${launchProgress.total})`
                        : busy
                          ? "…"
                          : `Launch ${vault.legCount} markets`}
                    </Button>
                  </>
                )}

                {vault.isMarketLive && (
                  <>
                    <p className="text-[11px] text-muted font-mono uppercase">Markets live</p>
                    <p className="text-[11px] text-muted">
                      All {vault.legCount} markets are trading. Your USDC stays in the vault during
                      the trading window. Claim opens when the market ends.
                    </p>
                    <MetaRow label="Market ends" value={<Countdown endTs={vault.marketEndTs} />} />
                  </>
                )}

                {vault.isClaimOpen && (
                  <>
                    <p className="text-[11px] text-muted font-mono uppercase">Claim outcome tokens</p>
                    <p className="text-[11px] text-muted">
                      Mint your <strong className="text-text-hi">YES tokens</strong> for each leg you
                      committed on, 1:1 with your USDC commit. After resolution, the winning leg's
                      YES tokens redeem for 1 USDC each via the market; losing legs' tokens are
                      worthless.
                    </p>
                    <Button onClick={handleClaim} disabled={busy || !publicKey} className="w-full">
                      {busy ? "…" : "Claim YES tokens"}
                    </Button>
                  </>
                )}

                {vault.isRefundOpen && (
                  <>
                    <p className="text-[11px] text-muted font-mono uppercase">Refund</p>
                    <p className="text-[11px] text-muted">
                      Commit ended below min total or at least one leg under 1%. Refunds open 1:1.
                    </p>
                    <Button onClick={handleRefund} disabled={busy || !publicKey} className="w-full">
                      {busy ? "…" : "Refund commit"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
