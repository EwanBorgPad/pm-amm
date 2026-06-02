"use client";

import Link from "next/link";
import { useVaults } from "@/hooks/use-vaults";
import { useVaultGroups } from "@/hooks/use-vault-groups";
import { Countdown } from "@/components/ui/countdown";
import { formatUsdc } from "@pm-amm/sdk/math";

/** Lightweight section on the home page listing every open vault.
 *  Hidden when nothing is open. */
export function VaultsSection() {
  const { data: binaries = [] } = useVaults();
  const { data: groups = [] } = useVaultGroups();

  // Only show vaults that still need user action on the commit/launch flow.
  // Once `launched` (binary) or `fullyLaunched` (multi-outcome), the vault's
  // underlying market(s) appear in the main `MarketTable` as standalone or
  // group rows — keeping them here too would duplicate the listing.
  const items = [
    ...binaries
      .filter((v) => !v.launched)
      .map((v) => ({
        kind: "binary" as const,
        publicKey: v.publicKey,
        vaultId: v.vaultId,
        name: v.name,
        total: v.total,
        minTotal: v.minTotal,
        commitEndTs: v.commitEndTs,
        commitCount: v.commitCount,
        legCount: 2,
        isCommitOpen: v.isCommitOpen,
        isLaunchReady: v.isLaunchReady,
        isMarketLive: v.isMarketLive,
        isClaimOpen: v.isClaimOpen,
        isRefundOpen: v.isRefundOpen,
        impliedSuffix: `YES ${(v.impliedPrice * 100).toFixed(2)}%`,
      })),
    ...groups
      .filter((v) => !v.fullyLaunched)
      .map((v) => ({
        kind: "group" as const,
        publicKey: v.publicKey,
        vaultId: v.vaultId,
        name: v.name,
        total: v.total,
        minTotal: v.minTotal,
        commitEndTs: v.commitEndTs,
        commitCount: v.commitCount,
        legCount: v.legCount,
        isCommitOpen: v.isCommitOpen,
        isLaunchReady: v.isLaunchReady,
        isMarketLive: v.isMarketLive,
        isClaimOpen: v.isClaimOpen,
        isRefundOpen: v.isRefundOpen,
        impliedSuffix: v.legs
          .slice()
          .sort((a, b) => b.shareBps - a.shareBps)
          .slice(0, 2)
          .map((l) => `${l.name} ${(l.shareBps / 100).toFixed(0)}%`)
          .join(" · "),
      })),
  ];

  if (items.length === 0) return null;

  return (
    <div className="border-b border-line">
      <div className="flex items-center justify-between px-[24px] py-[10px] font-mono text-[10px] tracking-[0.05em] uppercase text-muted">
        <span>Commitment vaults · {items.length} open</span>
        <Link href="/create-vault" className="text-text-hi hover:underline">
          + open vault
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-[1px] bg-line">
        {items.map((it) => (
          <Link
            key={it.publicKey}
            href={it.kind === "binary" ? `/vault/${it.vaultId}` : `/vault-group/${it.vaultId}`}
            className="block bg-bg p-[16px] hover:bg-surface transition-colors"
          >
            <div className="flex items-start justify-between gap-[8px] mb-[8px]">
              <h3 className="text-[13px] text-text-hi font-medium leading-tight">{it.name}</h3>
              <Tag kind={it.kind} />
            </div>

            <div className="flex flex-wrap gap-[6px] mb-[10px]">
              {it.isCommitOpen && <Badge tone="info">COMMIT OPEN</Badge>}
              {it.isLaunchReady && <Badge tone="yes">LAUNCH READY</Badge>}
              {it.isMarketLive && <Badge tone="yes">LIVE</Badge>}
              {it.isClaimOpen && <Badge tone="info">CLAIM OPEN</Badge>}
              {it.isRefundOpen && <Badge tone="no">REFUND OPEN</Badge>}
            </div>

            <div className="font-mono text-[10px] text-muted space-y-[2px]">
              <Row k="total" v={`${formatUsdc(it.total)} / ${formatUsdc(it.minTotal)} USDC`} />
              <Row k="committers" v={String(it.commitCount)} />
              <Row
                k={it.kind === "group" ? "legs" : "implied"}
                v={it.impliedSuffix || `${it.legCount} legs`}
              />
              {it.isCommitOpen ? (
                <Row k="commit ends" v={<Countdown endTs={it.commitEndTs} />} />
              ) : (
                <Row k="commit" v="ended" />
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Tag({ kind }: { kind: "binary" | "group" }) {
  return (
    <span
      className={[
        "text-[9px] px-[6px] py-[1px] font-mono tracking-[0.05em] uppercase border shrink-0",
        kind === "binary" ? "border-line text-muted" : "border-yes text-yes",
      ].join(" ")}
    >
      {kind === "binary" ? "Binary" : "Multi"}
    </span>
  );
}

function Badge({ tone, children }: { tone: "info" | "yes" | "no"; children: React.ReactNode }) {
  const cls =
    tone === "yes"
      ? "border-yes text-yes"
      : tone === "no"
        ? "border-no text-no"
        : "border-text-hi text-text-hi";
  return (
    <span
      className={`text-[9px] px-[6px] py-[1px] border font-mono tracking-[0.05em] uppercase ${cls}`}
    >
      {children}
    </span>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-[8px]">
      <span className="uppercase">{k}</span>
      <span className="text-text-hi">{v}</span>
    </div>
  );
}
