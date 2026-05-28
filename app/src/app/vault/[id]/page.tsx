"use client";

import { use, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { StatusBar } from "@/components/layout/status-bar";
import { Button } from "@/components/ui/button";
import { MetaRow } from "@/components/ui/meta-row";
import { Countdown } from "@/components/ui/countdown";
import { useProgram } from "@/hooks/use-program";
import { useVault } from "@/hooks/use-vaults";
import {
  runVaultCommit,
  runLaunchVaultMarket,
  runClaimCommitter,
  runRefundCommit,
} from "@/lib/vault";
import { solscanAccountUrl } from "@/lib/constants";
import { formatUsdc } from "@/lib/pm-math";
import { toast } from "sonner";
import Link from "next/link";

export default function VaultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: vault, isLoading } = useVault(Number(id));
  const program = useProgram();
  const { publicKey } = useWallet();

  const [amount, setAmount] = useState("5");
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [busy, setBusy] = useState(false);

  const handleCommit = async () => {
    if (!program || !publicKey || !vault) return;
    const num = parseFloat(amount || "0");
    if (num < 1) {
      toast.error("Minimum commit: 1 USDC");
      return;
    }
    setBusy(true);
    try {
      await runVaultCommit(program, publicKey, new PublicKey(vault.publicKey), side, num);
      toast.success(`Committed ${num} USDC on ${side.toUpperCase()}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.slice(0, 200));
    } finally {
      setBusy(false);
    }
  };

  const handleLaunch = async () => {
    if (!program || !publicKey || !vault) return;
    setBusy(true);
    try {
      const r = await runLaunchVaultMarket(program, publicKey, new PublicKey(vault.publicKey));
      toast.success(`Market ${r.marketId} launched at ${(vault.impliedPrice * 100).toFixed(2)}%`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.slice(0, 200));
    } finally {
      setBusy(false);
    }
  };

  const handleClaim = async () => {
    if (!program || !publicKey || !vault) return;
    setBusy(true);
    try {
      await runClaimCommitter(program, publicKey, new PublicKey(vault.publicKey));
      toast.success("Claimed your commit back");
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
      await runRefundCommit(program, publicKey, new PublicKey(vault.publicKey));
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
          <p className="text-no font-mono text-[12px]">Vault #{id} not found.</p>
        )}

        {vault && (
          <>
            <div className="flex items-center gap-[12px] flex-wrap mb-[8px]">
              <h2 className="text-title">{vault.name}</h2>
              {vault.launched && (
                <span className="text-[10px] px-[8px] py-[2px] border border-yes text-yes font-mono">
                  LAUNCHED
                </span>
              )}
              {vault.isCommitOpen && (
                <span className="text-[10px] px-[8px] py-[2px] border border-text-hi text-text-hi font-mono">
                  COMMIT OPEN
                </span>
              )}
              {vault.isLaunchReady && (
                <span className="text-[10px] px-[8px] py-[2px] border border-yes text-yes font-mono">
                  LAUNCH READY
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
                <MetaRow label="YES committed" value={`${formatUsdc(vault.yesTotal)} USDC`} />
                <MetaRow label="NO committed" value={`${formatUsdc(vault.noTotal)} USDC`} />
                <MetaRow label="Total" value={`${formatUsdc(vault.total)} USDC`} />
                <MetaRow label="Committers" value={String(vault.commitCount)} />
                <MetaRow
                  label="Implied YES price"
                  value={`${(vault.impliedPrice * 100).toFixed(2)}%`}
                />
                <MetaRow label="Min total" value={`${formatUsdc(vault.minTotal)} USDC`} />
                {vault.isCommitOpen ? (
                  <MetaRow label="Commit ends" value={<Countdown endTs={vault.commitEndTs} />} />
                ) : (
                  <MetaRow label="Commit ended" value="—" />
                )}
                {vault.launched && (
                  <MetaRow
                    label="Launched at"
                    value={`${(vault.winningPriceBps / 100).toFixed(2)}%`}
                  />
                )}
                {vault.market && (
                  <MetaRow
                    label="Market PDA"
                    value={
                      <a
                        href={solscanAccountUrl(vault.market)}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        ↗
                      </a>
                    }
                    last
                  />
                )}
              </div>

              <div className="space-y-[12px]">
                {vault.isCommitOpen && (
                  <>
                    <p className="text-[11px] text-muted font-mono uppercase">Commit</p>
                    <div className="flex gap-[8px]">
                      <Button
                        variant={side === "yes" ? "yes" : "ghost"}
                        onClick={() => setSide("yes")}
                      >
                        YES
                      </Button>
                      <Button
                        variant={side === "no" ? "no" : "ghost"}
                        onClick={() => setSide("no")}
                      >
                        NO
                      </Button>
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
                      {busy ? "…" : `Commit ${amount} USDC on ${side.toUpperCase()}`}
                    </Button>
                  </>
                )}

                {vault.isLaunchReady && (
                  <>
                    <p className="text-[11px] text-muted font-mono uppercase">
                      Launch (permissionless)
                    </p>
                    <p className="text-[11px] text-muted">
                      Anyone can launch — the new market starts at{" "}
                      <strong className="text-text-hi">
                        {(vault.impliedPrice * 100).toFixed(2)}%
                      </strong>{" "}
                      with {formatUsdc(vault.total)} USDC of initial liquidity.
                    </p>
                    <Button onClick={handleLaunch} disabled={busy || !publicKey} className="w-full">
                      {busy ? "…" : "Launch market"}
                    </Button>
                  </>
                )}

                {vault.launched && (
                  <>
                    <p className="text-[11px] text-muted font-mono uppercase">Claim</p>
                    <p className="text-[11px] text-muted">
                      Withdraw your commit back from the vault. (v1 returns 1:1; v2 will distribute
                      LP shares.)
                    </p>
                    <Button onClick={handleClaim} disabled={busy || !publicKey} className="w-full">
                      {busy ? "…" : "Claim committer"}
                    </Button>
                  </>
                )}

                {vault.isRefundOpen && (
                  <>
                    <p className="text-[11px] text-muted font-mono uppercase">Refund</p>
                    <p className="text-[11px] text-muted">
                      Commit ended below min total. Refunds are open 1:1.
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
