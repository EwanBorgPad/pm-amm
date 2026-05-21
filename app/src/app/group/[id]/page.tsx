"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PublicKey } from "@solana/web3.js";
import { StatusBar } from "@/components/layout/status-bar";
import { Badge } from "@/components/ui/badge";
import { Countdown } from "@/components/ui/countdown";
import { Sparkline } from "@/components/ui/sparkline";
import { TradePanel } from "@/components/trade-panel";
import { MultiLineChart, seriesColor, type Series } from "@/components/multi-line-chart";
import { useMarkets, type MarketData } from "@/hooks/use-markets";
import { useGroup, type GroupData } from "@/hooks/use-groups";
import { usePriceHistories } from "@/hooks/use-price-histories";
import { useUserTokens } from "@/hooks/use-user-tokens";
import { groupDriftPct } from "@/lib/pm-math";
import { USDC_MINT, solscanAccountUrl } from "@/lib/constants";
import { deriveYesMint, deriveNoMint } from "@/lib/pda";

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: markets } = useMarkets();
  const { data: group, isLoading } = useGroup(Number(id), markets);
  const priceHistories = usePriceHistories(markets);

  return (
    <>
      <StatusBar />
      <main className="flex-1 mx-auto w-full max-w-7xl px-[24px] py-[24px]">
        <Link
          href="/"
          className="text-[12px] text-muted hover:text-text-hi transition-all duration-[120ms] mb-[16px] block font-mono tracking-[0.03em]"
        >
          ← BACK
        </Link>

        {isLoading && <p className="text-muted font-mono text-[12px]">Loading…</p>}
        {!isLoading && !group && (
          <p className="text-no font-mono text-[12px]">Group #{id} not found.</p>
        )}

        {group && <GroupView group={group} priceHistories={priceHistories} />}
      </main>
    </>
  );
}

interface GroupViewProps {
  group: GroupData;
  priceHistories: Map<string, number[]> | undefined;
}

function GroupView({ group, priceHistories }: GroupViewProps) {
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const isResolved = group.resolved;

  const attachedLegs = useMemo(
    () =>
      group.legs.map((m, i) => ({ market: m, idx: i })).filter((x) => x.market !== null) as {
        market: MarketData;
        idx: number;
      }[],
    [group.legs],
  );

  const drift = groupDriftPct(attachedLegs.map((x) => x.market.price));

  // Build series for the multi-line chart from cached price histories.
  // Falls back to a flat line at the current price if no history exists.
  const series: Series[] = useMemo(
    () =>
      attachedLegs.map(({ market, idx }) => {
        const cached = priceHistories?.get(market.publicKey) ?? [];
        const points = cached.length >= 2 ? cached : [market.price, market.price];
        return {
          id: String(idx),
          label: market.name,
          color: seriesColor(idx),
          points: [...points, market.price],
        };
      }),
    [attachedLegs, priceHistories],
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-[24px]">
      <div className="space-y-[16px] min-w-0">
        <GroupHeader group={group} drift={drift} />

        <div className="border border-line p-[16px]">
          <MultiLineChart
            series={series}
            width={760}
            height={240}
            highlightId={String(selectedIdx)}
          />
          <LegLegend
            attachedLegs={attachedLegs}
            selectedIdx={selectedIdx}
            onSelect={setSelectedIdx}
          />
        </div>

        <LegsTable
          attachedLegs={attachedLegs}
          priceHistories={priceHistories}
          selectedIdx={selectedIdx}
          onSelect={setSelectedIdx}
          resolved={isResolved}
          winningLeg={group.winningLeg}
        />
      </div>

      <aside className="xl:sticky xl:top-[16px] xl:self-start">
        <SideTradePanel group={group} selectedIdx={selectedIdx} legs={attachedLegs} />
      </aside>
    </div>
  );
}

function GroupHeader({ group, drift }: { group: GroupData; drift: number }) {
  const isResolved = group.resolved;
  const isExpired = Math.floor(Date.now() / 1000) >= group.endTs;
  const badge = isResolved ? (
    <Badge variant="yes">RESOLVED · Leg #{group.winningLeg}</Badge>
  ) : isExpired ? (
    <Badge variant="no">Awaiting resolution</Badge>
  ) : (
    <Badge variant="yes" dot>
      Active
    </Badge>
  );

  return (
    <div className="flex items-center gap-[12px] flex-wrap">
      <h2 className="text-title">{group.name}</h2>
      {badge}
      <span className="text-[11px] font-mono text-muted">
        Σ p_i = {group.sumProbabilities.toFixed(3)} (drift {drift.toFixed(2)}%)
      </span>
      <span className="text-[11px] font-mono text-muted">
        Expires <Countdown endTs={group.endTs} />
      </span>
      <button
        onClick={() => {
          navigator.clipboard.writeText(window.location.href);
          toast.success("Link copied");
        }}
        className="text-[11px] text-muted hover:text-text-hi font-mono cursor-pointer ml-auto"
      >
        Copy link
      </button>
      <a
        href={solscanAccountUrl(group.publicKey)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-muted hover:text-text-hi font-mono"
      >
        Solscan ↗
      </a>
    </div>
  );
}

interface LegLegendProps {
  attachedLegs: { market: MarketData; idx: number }[];
  selectedIdx: number;
  onSelect: (i: number) => void;
}

function LegLegend({ attachedLegs, selectedIdx, onSelect }: LegLegendProps) {
  return (
    <div className="flex flex-wrap gap-[8px] mt-[12px] pt-[12px] border-t border-line">
      {attachedLegs.map(({ market, idx }) => (
        <button
          key={idx}
          onClick={() => onSelect(idx)}
          className={[
            "flex items-center gap-[6px] px-[8px] py-[3px] rounded-sm border cursor-pointer font-mono text-[11px]",
            selectedIdx === idx
              ? "border-line-2 bg-surface"
              : "border-line text-muted hover:text-text-hi",
          ].join(" ")}
        >
          <span
            className="inline-block w-[8px] h-[8px] rounded-full"
            style={{ background: seriesColor(idx) }}
          />
          <span className="truncate max-w-[120px]">{market.name}</span>
          <span className="text-text-hi tabular-nums">{(market.price * 100).toFixed(1)}%</span>
        </button>
      ))}
    </div>
  );
}

interface LegsTableProps {
  attachedLegs: { market: MarketData; idx: number }[];
  priceHistories: Map<string, number[]> | undefined;
  selectedIdx: number;
  onSelect: (i: number) => void;
  resolved: boolean;
  winningLeg: number | null;
}

function LegsTable({
  attachedLegs,
  priceHistories,
  selectedIdx,
  onSelect,
  resolved,
  winningLeg,
}: LegsTableProps) {
  return (
    <div className="border border-line">
      <div className="grid grid-cols-[1fr_80px_80px_120px_120px] gap-[12px] px-[12px] py-[8px] border-b border-line text-[10px] font-mono uppercase tracking-[0.05em] text-muted">
        <span>Outcome</span>
        <span className="text-right">7d</span>
        <span className="text-right">YES</span>
        <span></span>
        <span></span>
      </div>
      {attachedLegs.map(({ market, idx }) => (
        <LegRow
          key={idx}
          market={market}
          idx={idx}
          history={priceHistories?.get(market.publicKey) ?? []}
          isSelected={selectedIdx === idx}
          isWinner={resolved && winningLeg === idx}
          isLoser={resolved && winningLeg !== idx}
          onSelect={onSelect}
          resolved={resolved}
        />
      ))}
    </div>
  );
}

interface LegRowProps {
  market: MarketData;
  idx: number;
  history: number[];
  isSelected: boolean;
  isWinner: boolean;
  isLoser: boolean;
  onSelect: (i: number) => void;
  resolved: boolean;
}

function LegRow({
  market,
  idx,
  history,
  isSelected,
  isWinner,
  isLoser,
  onSelect,
  resolved,
}: LegRowProps) {
  const delta = history.length >= 2 ? market.price - history[0] : 0;
  const rowClass = [
    "grid grid-cols-[1fr_80px_80px_120px_120px] gap-[12px] px-[12px] py-[10px] cursor-pointer transition-all duration-[120ms] items-center",
    "border-b border-line last:border-b-0",
    isSelected ? "bg-surface" : "hover:bg-surface-2",
    isLoser ? "opacity-40" : "",
  ].join(" ");

  const click = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(idx);
  };

  return (
    <div onClick={() => onSelect(idx)} className={rowClass}>
      <div className="flex items-center gap-[8px] min-w-0">
        <span
          className="inline-block w-[8px] h-[8px] rounded-full flex-shrink-0"
          style={{ background: seriesColor(idx) }}
        />
        <span className="truncate text-[13px]">{market.name}</span>
        {isWinner && <Badge variant="yes">WINNER</Badge>}
      </div>
      <div className="text-right">
        {history.length >= 3 ? (
          <Sparkline
            points={history}
            color={delta >= 0 ? "var(--yes)" : "var(--no)"}
            width={64}
            height={16}
            midline={false}
          />
        ) : (
          <span className="text-[10px] text-muted font-mono">—</span>
        )}
      </div>
      <div className="text-right">
        <div className="text-[16px] font-mono tabular-nums">{(market.price * 100).toFixed(1)}%</div>
        {history.length >= 2 && (
          <div className={`text-[10px] font-mono ${delta >= 0 ? "text-yes" : "text-no"}`}>
            {delta >= 0 ? "▲" : "▼"} {(Math.abs(delta) * 100).toFixed(1)}%
          </div>
        )}
      </div>
      <BetButton side="yes" price={market.price} disabled={resolved} onClick={click} />
      <BetButton side="no" price={1 - market.price} disabled={resolved} onClick={click} />
    </div>
  );
}

function BetButton({
  side,
  price,
  disabled,
  onClick,
}: {
  side: "yes" | "no";
  price: number;
  disabled: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const cls =
    side === "yes"
      ? "bg-yes/10 text-yes border-yes/30 hover:bg-yes/20"
      : "bg-no/10 text-no border-no/30 hover:bg-no/20";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-[10px] py-[6px] rounded-md text-[11px] font-mono border ${cls} disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-[120ms]`}
    >
      Buy {side.toUpperCase()} {(price * 100).toFixed(1)}¢
    </button>
  );
}

interface SideTradePanelProps {
  group: GroupData;
  selectedIdx: number;
  legs: { market: MarketData; idx: number }[];
}

function SideTradePanel({ group, selectedIdx, legs }: SideTradePanelProps) {
  const selected = legs.find((l) => l.idx === selectedIdx) ?? legs[0];
  const market = selected?.market;

  // Compute YES/NO token mints to fetch the user balances for the selected leg.
  const yesMint = market ? deriveYesMint(new PublicKey(market.publicKey)).toBase58() : undefined;
  const noMint = market ? deriveNoMint(new PublicKey(market.publicKey)).toBase58() : undefined;
  const { data: tokens } = useUserTokens(yesMint, noMint, USDC_MINT.toBase58());

  if (!market) {
    return (
      <div className="border border-line p-[16px] text-[12px] text-muted font-mono">
        No leg available.
      </div>
    );
  }

  if (group.resolved) {
    return (
      <div className="border border-line p-[16px] space-y-[8px]">
        <p className="text-caption">RESOLVED</p>
        <p className="text-[12px] font-mono">
          Winning leg: #{group.winningLeg} ·{" "}
          <Link
            href={`/market/${legs.find((l) => l.idx === group.winningLeg)?.market.marketId}`}
            className="text-text-hi underline"
          >
            view market
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-[8px]">
      <div className="border border-line p-[12px] flex items-center gap-[8px]">
        <span
          className="inline-block w-[10px] h-[10px] rounded-full flex-shrink-0"
          style={{ background: seriesColor(selectedIdx) }}
        />
        <div className="min-w-0">
          <div className="text-[11px] font-mono text-muted uppercase tracking-[0.05em]">
            Trading
          </div>
          <div className="text-[13px] truncate">{market.name}</div>
        </div>
      </div>

      <TradePanel market={market} tokens={tokens ?? null} />
    </div>
  );
}
