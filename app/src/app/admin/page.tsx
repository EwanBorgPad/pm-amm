"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { StatusBar } from "@/components/layout/status-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MetaRow } from "@/components/ui/meta-row";
import { useMarkets, type MarketData } from "@/hooks/use-markets";
import { useGroups, type GroupData } from "@/hooks/use-groups";
import { useClient } from "@/lib/pm-amm-client";
import { formatTimeRemaining } from "@pm-amm/sdk/math";
import { PublicKey } from "@solana/web3.js";
import { toast } from "sonner";
import Link from "next/link";
import { seriesColor } from "@/components/multi-line-chart";

type MarketStatus = "active" | "expired" | "resolved";

function getAdminStatus(m: MarketData): MarketStatus {
  if (m.resolved) return "resolved";
  const now = Math.floor(Date.now() / 1000);
  return now >= m.endTs ? "expired" : "active";
}

function useResolveBinary(market: MarketData) {
  const client = useClient();
  const { publicKey } = useWallet();
  const [loading, setLoading] = useState<"yes" | "no" | null>(null);

  const resolve = async (side: "yes" | "no") => {
    if (!client || !publicKey) return;
    setLoading(side);
    try {
      await client.send.resolveMarket(new PublicKey(market.publicKey), side);
      toast.success(`Resolved → ${side.toUpperCase()}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("WalletSign") || msg.includes("User rejected")) {
        toast.info("Transaction cancelled");
        return;
      }
      toast.error("Resolve failed", { description: msg.slice(0, 150) });
    } finally {
      setLoading(null);
    }
  };

  return { loading, resolve };
}

function AdminMarketRow({ market }: { market: MarketData }) {
  const status = getAdminStatus(market);
  const { loading, resolve } = useResolveBinary(market);

  return (
    <div className="border border-line p-[16px] space-y-[8px]">
      <div className="flex items-center justify-between">
        <div className="font-sans text-[14px] text-text-hi">{market.name}</div>
        <Badge
          variant={status === "resolved" ? (market.winningSide === 1 ? "yes" : "no") : "default"}
        >
          {status === "resolved"
            ? `${market.winningSide === 1 ? "YES" : "NO"} WON`
            : status.toUpperCase()}
        </Badge>
      </div>

      <MetaRow label="ID" value={`#${market.marketId}`} />
      <MetaRow label="YES" value={market.price.toFixed(4)} />
      <MetaRow
        label="Expires"
        value={formatTimeRemaining(market.endTs)}
        last={status !== "expired"}
      />

      {status === "expired" && (
        <div className="grid grid-cols-2 gap-[8px] pt-[8px]">
          <Button
            variant="yes"
            className="w-full"
            onClick={() => resolve("yes")}
            disabled={loading !== null}
          >
            {loading === "yes" ? "..." : "RESOLVE YES"}
          </Button>
          <Button
            variant="no"
            className="w-full"
            onClick={() => resolve("no")}
            disabled={loading !== null}
          >
            {loading === "no" ? "..." : "RESOLVE NO"}
          </Button>
        </div>
      )}
    </div>
  );
}

function useResolveGroupAction(group: GroupData) {
  const client = useClient();
  const { publicKey } = useWallet();
  const [pickedLeg, setPickedLeg] = useState<number | null>(null);
  const [progress, setProgress] = useState<{
    label: string;
    i: number;
    n: number;
  } | null>(null);

  const onAction = async (winningLeg: number | null) => {
    if (!client || !publicKey) return;
    try {
      const DEFAULT = "11111111111111111111111111111111";
      const legMarkets = group.legPubkeys.map((pk) => (pk === DEFAULT ? null : new PublicKey(pk)));
      await client.flows.resolveGroup({
        group: new PublicKey(group.publicKey),
        legMarkets,
        winningLeg,
        onProgress: (label, i, n) => setProgress({ label, i, n }),
      });
      setProgress(null);
      toast.success(
        winningLeg === null
          ? `Group #${group.groupId} cancelled`
          : `Group #${group.groupId} resolved → Leg ${winningLeg}`,
      );
    } catch (err: unknown) {
      setProgress(null);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("WalletSign") || msg.includes("User rejected")) {
        toast.info("Transaction cancelled");
        return;
      }
      toast.error("Group resolve failed", { description: msg.slice(0, 200) });
    }
  };

  return { pickedLeg, setPickedLeg, progress, onAction };
}

function AdminGroupRow({ group }: { group: GroupData }) {
  const now = Math.floor(Date.now() / 1000);
  const isExpired = now >= group.endTs;
  const isResolved = group.resolved;
  const isCancelled = isResolved && group.winningLeg === null;
  const status = isResolved ? "resolved" : isExpired ? "expired" : "active";
  const { pickedLeg, setPickedLeg, progress, onAction } = useResolveGroupAction(group);

  return (
    <div className="border border-line p-[16px] space-y-[12px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-[8px] min-w-0">
          <div className="font-sans text-[14px] text-text-hi truncate">{group.name}</div>
          <span className="text-[10px] font-mono text-muted">{group.legCount} legs</span>
        </div>
        <Badge variant={status === "resolved" ? "yes" : "default"}>
          {isCancelled
            ? "CANCELLED"
            : isResolved
              ? `LEG #${group.winningLeg} WON`
              : status.toUpperCase()}
        </Badge>
      </div>

      <MetaRow label="ID" value={`#${group.groupId}`} />
      <MetaRow label="Σ p_i" value={group.sumProbabilities.toFixed(3)} />
      <MetaRow
        label="Expires"
        value={formatTimeRemaining(group.endTs)}
        last={!isExpired || isResolved}
      />

      {isExpired && !isResolved && (
        <GroupResolveControls
          group={group}
          pickedLeg={pickedLeg}
          setPickedLeg={setPickedLeg}
          progress={progress}
          onResolve={() => pickedLeg !== null && onAction(pickedLeg)}
          onCancel={() => onAction(null)}
        />
      )}

      {isResolved && (
        <Link
          href={`/group/${group.groupId}`}
          className="block text-[11px] text-muted hover:text-text-hi font-mono pt-[4px]"
        >
          View group →
        </Link>
      )}
    </div>
  );
}

interface GroupResolveControlsProps {
  group: GroupData;
  pickedLeg: number | null;
  setPickedLeg: (i: number | null) => void;
  progress: { label: string; i: number; n: number } | null;
  onResolve: () => void;
  onCancel: () => void;
}

function GroupResolveControls({
  group,
  pickedLeg,
  setPickedLeg,
  progress,
  onResolve,
  onCancel,
}: GroupResolveControlsProps) {
  return (
    <div className="space-y-[8px] pt-[8px] border-t border-line">
      <p className="text-[10px] font-mono text-muted uppercase tracking-[0.05em]">
        Pick the winning leg
      </p>
      <div className="grid grid-cols-2 gap-[6px]">
        {group.legs.map((m, i) => (
          <button
            key={i}
            onClick={() => setPickedLeg(i)}
            disabled={progress !== null}
            className={[
              "flex items-center gap-[6px] px-[8px] py-[6px] rounded-sm border text-left",
              "font-mono text-[11px] transition-all duration-[120ms]",
              pickedLeg === i
                ? "border-line-2 bg-surface text-text-hi"
                : "border-line text-muted hover:text-text-hi",
              progress !== null ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
          >
            <span
              className="inline-block w-[8px] h-[8px] rounded-full flex-shrink-0"
              style={{ background: seriesColor(i) }}
            />
            <span className="truncate">{m?.name ?? `Leg ${i}`}</span>
          </button>
        ))}
      </div>

      {progress && (
        <div className="space-y-[4px]">
          <p className="text-[10px] font-mono text-muted">
            {progress.label} ({progress.i}/{progress.n})
          </p>
          <div className="w-full h-[2px] bg-line">
            <div
              className="h-full bg-yes transition-all duration-[300ms]"
              style={{ width: `${(progress.i / progress.n) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-[8px] pt-[4px]">
        <Button
          variant="yes"
          className="w-full"
          disabled={pickedLeg === null || progress !== null}
          onClick={onResolve}
        >
          Resolve
        </Button>
        <Button variant="no" className="w-full" disabled={progress !== null} onClick={onCancel}>
          Cancel group
        </Button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { publicKey } = useWallet();
  const { data: markets, isLoading } = useMarkets();
  const { data: groups } = useGroups(markets);

  // Standalone markets owned by me (exclude attached legs — those resolve via
  // the group cascade, not the binary RESOLVE YES/NO buttons).
  const standalone = markets?.filter(
    (m) => m.authority === publicKey?.toBase58() && m.group === "",
  );
  const sortedMarkets = standalone?.sort((a, b) => {
    const order: Record<MarketStatus, number> = {
      expired: 0,
      active: 1,
      resolved: 2,
    };
    return order[getAdminStatus(a)] - order[getAdminStatus(b)];
  });

  const ownedGroups = groups
    ?.filter((g) => g.authority === publicKey?.toBase58())
    .sort((a, b) => {
      // expired+unresolved first, then active, then resolved
      const rank = (g: GroupData) => {
        const now = Math.floor(Date.now() / 1000);
        if (g.resolved) return 2;
        if (now >= g.endTs) return 0;
        return 1;
      };
      return rank(a) - rank(b);
    });

  return (
    <>
      <StatusBar />
      <main className="flex-1 max-w-lg mx-auto w-full px-[48px] py-[32px]">
        <Link
          href="/markets"
          className="text-[12px] text-muted hover:text-text-hi transition-all duration-[120ms] mb-[16px] block font-mono tracking-[0.03em]"
        >
          ← BACK
        </Link>

        {!publicKey && (
          <p className="text-[12px] text-muted font-mono">Connect wallet to view your markets.</p>
        )}

        {isLoading && <p className="text-[12px] text-muted font-mono">Loading…</p>}

        {publicKey && (
          <>
            <div className="text-caption mb-[12px]">ADMIN — GROUP MARKETS</div>
            {(!ownedGroups || ownedGroups.length === 0) && (
              <p className="text-[12px] text-muted font-mono mb-[24px]">
                No groups owned by this wallet.
              </p>
            )}
            <div className="space-y-[12px] mb-[24px]">
              {ownedGroups?.map((g) => (
                <AdminGroupRow key={g.publicKey} group={g} />
              ))}
            </div>

            <div className="text-caption mb-[12px]">ADMIN — BINARY MARKETS (STANDALONE)</div>
            {(!sortedMarkets || sortedMarkets.length === 0) && (
              <p className="text-[12px] text-muted font-mono">
                No standalone markets owned by this wallet.
              </p>
            )}
            <div className="space-y-[12px]">
              {sortedMarkets?.map((m) => (
                <AdminMarketRow key={m.publicKey} market={m} />
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
