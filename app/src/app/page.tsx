"use client";

import { useState, useMemo } from "react";
import { StatusBar } from "@/components/layout/status-bar";
import { MarketTable, type FeedItem } from "@/components/market-table";
import { MarketDetailPanel } from "@/components/market-detail-panel";
import { VaultsSection } from "@/components/vaults-section";
import { useMarkets } from "@/hooks/use-markets";
import { useGroups } from "@/hooks/use-groups";
import { useUserPositions } from "@/hooks/use-user-positions";
import { usePriceRecorder } from "@/hooks/use-price-recorder";
import { usePriceHistories } from "@/hooks/use-price-histories";
import { PortfolioPanel } from "@/components/portfolio-panel";
import { poolValue } from "@/lib/pm-math";
import Link from "next/link";

type Filter = "all" | "active" | "expiring" | "resolved" | "positions";
type Sort = "tvl" | "expiry" | "newest";

export default function Home() {
  const { data: markets, isLoading, error } = useMarkets();
  const { data: groups } = useGroups(markets);
  const { data: userPositions } = useUserPositions(markets);
  usePriceRecorder(markets);
  const priceHistories = usePriceHistories(markets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("tvl");

  /** Build the unified feed: standalone markets (drop legs) + group rows
   *  (one per GroupMarket, collapsing N legs). */
  const feedItems: FeedItem[] = useMemo(() => {
    if (!markets) return [];
    const now = Math.floor(Date.now() / 1000);

    // Standalone markets only — drop legs since they're represented by their
    // parent group row below.
    const standalone = markets
      .filter((m) => !m.group)
      .map((m): FeedItem => ({ kind: "market", market: m }));

    // Group rows
    const groupRows = (groups ?? []).map((g): FeedItem => ({ kind: "group", group: g }));

    let result: FeedItem[] = [...standalone, ...groupRows];

    // Filters
    if (filter === "active") {
      result = result.filter((it) =>
        it.kind === "market"
          ? !it.market.resolved && it.market.endTs > now
          : !it.group.resolved && it.group.endTs > now,
      );
    } else if (filter === "resolved") {
      result = result.filter((it) =>
        it.kind === "market" ? it.market.resolved : it.group.resolved,
      );
    } else if (filter === "expiring") {
      result = result.filter((it) => {
        if (it.kind === "market") {
          return !it.market.resolved && it.market.endTs - now > 0 && it.market.endTs - now < 86400;
        }
        return !it.group.resolved && it.group.endTs - now > 0 && it.group.endTs - now < 86400;
      });
    } else if (filter === "positions") {
      // User positions are keyed by standalone-market pubkey. For groups, we
      // mark them as "my bet" if the user has a position in any attached leg.
      result = result.filter((it) => {
        if (it.kind === "market") return userPositions?.has(it.market.publicKey) ?? false;
        return it.group.legs.some((l) => l && userPositions?.has(l.publicKey));
      });
    }

    // Sort within active / inactive partitions so freshly-launched markets
    // never get buried below resolved or expired ones, regardless of TVL.
    const isItemActive = (it: FeedItem) =>
      it.kind === "market"
        ? !it.market.resolved && it.market.endTs > now
        : !it.group.resolved && it.group.endTs > now;

    const cmp = (a: FeedItem, b: FeedItem): number => {
      if (sort === "tvl") {
        const tvlA = a.kind === "market" ? itemTvl(a.market) : groupItemTvl(a.group);
        const tvlB = b.kind === "market" ? itemTvl(b.market) : groupItemTvl(b.group);
        return tvlB - tvlA;
      }
      if (sort === "expiry") {
        const eA = a.kind === "market" ? a.market.endTs : a.group.endTs;
        const eB = b.kind === "market" ? b.market.endTs : b.group.endTs;
        return eA - eB;
      }
      // newest
      const sA = a.kind === "market" ? a.market.startTs : a.group.startTs;
      const sB = b.kind === "market" ? b.market.startTs : b.group.startTs;
      return sB - sA;
    };

    const active = result.filter(isItemActive).sort(cmp);
    const inactive = result.filter((it) => !isItemActive(it)).sort(cmp);
    return [...active, ...inactive];
  }, [markets, groups, filter, sort, userPositions]);

  const selectedMarket =
    selectedId === null ? null : (markets?.find((m) => m.publicKey === selectedId) ?? null);
  const positionCount = userPositions?.size ?? 0;

  const standaloneCount = markets?.filter((m) => !m.group).length ?? 0;
  const groupCount = groups?.length ?? 0;
  const totalCount = standaloneCount + groupCount;

  const activeCount =
    (markets?.filter((m) => !m.group && !m.resolved && m.endTs > Math.floor(Date.now() / 1000))
      .length ?? 0) +
    (groups?.filter((g) => !g.resolved && g.endTs > Math.floor(Date.now() / 1000)).length ?? 0);

  const resolvedCount =
    (markets?.filter((m) => !m.group && m.resolved).length ?? 0) +
    (groups?.filter((g) => g.resolved).length ?? 0);

  const filters: { key: Filter; label: string; count?: number }[] = [
    { key: "all", label: "All", count: totalCount },
    { key: "active", label: "Active", count: activeCount },
    { key: "expiring", label: "<24h" },
    { key: "resolved", label: "Resolved", count: resolvedCount },
    { key: "positions", label: "My bets", count: positionCount || undefined },
  ];

  const sorts: { key: Sort; label: string }[] = [
    { key: "tvl", label: "TVL" },
    { key: "expiry", label: "Expiry" },
    { key: "newest", label: "New" },
  ];

  return (
    <>
      <StatusBar />
      <div className="grid min-h-[calc(100vh-38px)] grid-cols-1 xl:grid-cols-[1fr_300px]">
        <main className="flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-[24px] py-[12px] border-b border-line font-mono text-[11px] tracking-[0.05em] gap-[12px] flex-wrap">
            <div className="flex gap-[4px]">
              {filters.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={[
                    "px-[10px] py-[4px] rounded-sm border cursor-pointer",
                    "transition-all duration-[120ms] uppercase",
                    filter === f.key
                      ? "text-text-hi border-line-2 bg-surface"
                      : "text-muted border-transparent hover:text-text-hi",
                  ].join(" ")}
                >
                  {f.label}
                  {f.count !== undefined && f.count > 0 && (
                    <span className="ml-[4px] text-muted text-[10px]">{f.count}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="flex gap-[8px] items-center">
              <div className="flex gap-[2px] border border-line rounded-sm">
                {sorts.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setSort(s.key)}
                    className={[
                      "px-[8px] py-[3px] text-[10px] cursor-pointer transition-all duration-[120ms]",
                      sort === s.key ? "text-text-hi bg-surface" : "text-muted hover:text-text-hi",
                    ].join(" ")}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <Link href="/create-vault">
                <button className="px-[10px] py-[4px] border border-line text-muted hover:text-text-hi rounded-sm font-mono text-[11px] tracking-[0.03em] font-medium cursor-pointer">
                  + VAULT
                </button>
              </Link>
              <Link href="/create">
                <button className="px-[10px] py-[4px] bg-text-hi text-bg border border-text-hi rounded-sm font-mono text-[11px] tracking-[0.03em] font-medium cursor-pointer">
                  + NEW
                </button>
              </Link>
            </div>
          </div>

          {/* Open vaults — binary + multi-outcome (hidden when none) */}
          <VaultsSection />

          {/* Loading skeleton */}
          {isLoading && (
            <div className="flex-1 min-w-0 flex flex-col">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="grid gap-[12px] px-[24px] py-[12px] border-b border-line grid-cols-[1fr_60px_160px_80px_72px_60px]"
                >
                  {Array.from({ length: 6 }).map((_, j) => (
                    <div
                      key={j}
                      className="h-[14px] animate-pulse rounded-sm bg-surface border border-line"
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="p-[24px] text-no font-mono text-[12px]">
              Error: {(error as Error).message}
            </div>
          )}

          {feedItems.length > 0 && (
            <MarketTable
              items={feedItems}
              selectedId={selectedId}
              onSelect={setSelectedId}
              priceHistories={priceHistories}
            />
          )}

          {!isLoading && !error && feedItems.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-[12px] p-[48px]">
              <div className="text-[11px] text-muted font-mono uppercase tracking-[0.05em]">
                {filter === "positions" ? "No positions found" : "No markets yet"}
              </div>
              <Link href="/create">
                <button className="px-[14px] py-[6px] bg-text-hi text-bg border border-text-hi rounded-sm font-mono text-[11px] tracking-[0.03em] font-medium cursor-pointer">
                  + CREATE MARKET
                </button>
              </Link>
            </div>
          )}
        </main>

        {selectedMarket ? <MarketDetailPanel market={selectedMarket} /> : <PortfolioPanel />}
      </div>
    </>
  );
}

/** Pool value of a standalone market for the TVL sort. */
function itemTvl(m: { lEff: number; price: number }): number {
  return m.lEff > 0 ? poolValue(m.price, m.lEff) : 0;
}

/** Sum of pool values across a group's attached legs. */
function groupItemTvl(g: { legs: ({ lEff: number; price: number } | null)[] }): number {
  let sum = 0;
  for (const leg of g.legs) {
    if (leg && leg.lEff > 0) sum += poolValue(leg.price, leg.lEff);
  }
  return sum;
}
