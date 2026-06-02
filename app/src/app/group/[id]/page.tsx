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
import { usePriceRecorder } from "@/hooks/use-price-recorder";
import { useUserTokens } from "@/hooks/use-user-tokens";
import { useClient } from "@/lib/pm-amm-client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect } from "react";
import { groupDriftPct, formatUsdc } from "@pm-amm/sdk/math";
import { deriveYesMint, deriveNoMint } from "@pm-amm/sdk";
import { PROGRAM_ID, USDC_MINT, solscanAccountUrl } from "@/lib/constants";
import { Button } from "@/components/ui/button";

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: markets } = useMarkets();
  const { data: group, isLoading } = useGroup(Number(id), markets);
  const priceHistories = usePriceHistories(markets);
  // Record price snapshots passively. Without this on the group page,
  // visitors who land here directly via a shared link don't contribute to
  // the price history Redis store, and the multi-line chart stays flat.
  usePriceRecorder(markets);

  return (
    <>
      <StatusBar />
      <main className="flex-1 mx-auto w-full max-w-7xl px-[24px] py-[24px]">
        <Link
          href="/markets"
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
  // Side intent for the trade panel, driven by the per-leg "Buy YES/NO" buttons.
  // `nonce` bumps on every click so re-clicking the same button re-applies it.
  const [trade, setTrade] = useState<{ side: "yes" | "no"; nonce: number }>({
    side: "yes",
    nonce: 0,
  });
  const onBet = (idx: number, side: "yes" | "no") => {
    setSelectedIdx(idx);
    setTrade((t) => ({ side, nonce: t.nonce + 1 }));
  };
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
          onBet={onBet}
          resolved={isResolved}
          winningLeg={group.winningLeg}
        />
      </div>

      <aside className="xl:sticky xl:top-[16px] xl:self-start">
        <SideTradePanel group={group} selectedIdx={selectedIdx} legs={attachedLegs} trade={trade} />
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
  onBet: (i: number, side: "yes" | "no") => void;
  resolved: boolean;
  winningLeg: number | null;
}

function LegsTable({
  attachedLegs,
  priceHistories,
  selectedIdx,
  onSelect,
  onBet,
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
          onBet={onBet}
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
  onBet: (i: number, side: "yes" | "no") => void;
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
  onBet,
  resolved,
}: LegRowProps) {
  const delta = history.length >= 2 ? market.price - history[0] : 0;
  const rowClass = [
    "grid grid-cols-[1fr_80px_80px_120px_120px] gap-[12px] px-[12px] py-[10px] cursor-pointer transition-all duration-[120ms] items-center",
    "border-b border-line last:border-b-0",
    isSelected ? "bg-surface" : "hover:bg-surface-2",
    isLoser ? "opacity-40" : "",
  ].join(" ");

  const bet = (side: "yes" | "no") => (e: React.MouseEvent) => {
    e.stopPropagation();
    onBet(idx, side);
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
      <BetButton side="yes" price={market.price} disabled={resolved} onClick={bet("yes")} />
      <BetButton side="no" price={1 - market.price} disabled={resolved} onClick={bet("no")} />
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
  trade: { side: "yes" | "no"; nonce: number };
}

function SideTradePanel({ group, selectedIdx, legs, trade }: SideTradePanelProps) {
  const selected = legs.find((l) => l.idx === selectedIdx) ?? legs[0];
  const market = selected?.market;

  // Compute YES/NO token mints to fetch the user balances for the selected leg.
  const yesMint = market
    ? deriveYesMint(PROGRAM_ID, new PublicKey(market.publicKey)).toBase58()
    : undefined;
  const noMint = market
    ? deriveNoMint(PROGRAM_ID, new PublicKey(market.publicKey)).toBase58()
    : undefined;
  const { data: tokens } = useUserTokens(yesMint, noMint, USDC_MINT.toBase58());

  if (!market) {
    return (
      <div className="border border-line p-[16px] text-[12px] text-muted font-mono">
        No leg available.
      </div>
    );
  }

  if (group.resolved) {
    return <ResolvedClaimPanel group={group} legs={legs} />;
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

      <TradePanel
        market={market}
        tokens={tokens ?? null}
        presetSide={trade.side}
        presetNonce={trade.nonce}
      />
    </div>
  );
}

interface ClaimableDisplay {
  legIndex: number;
  name: string;
  expectedPayout: number;
}

interface ClaimAllState {
  claimable: ClaimableDisplay[] | null;
  progress: { label: string; i: number; n: number } | null;
  loading: boolean;
  totalMicroUsdc: number;
  onClaim: () => Promise<void>;
}

function useGroupClaimAll(group: GroupData): ClaimAllState {
  const { publicKey } = useWallet();
  const client = useClient();
  const [claimable, setClaimable] = useState<ClaimableDisplay[] | null>(null);
  const [progress, setProgress] = useState<ClaimAllState["progress"]>(null);
  const [loading, setLoading] = useState(false);

  const legMarkets = useMemo(
    () => group.legs.map((m) => (m ? new PublicKey(m.publicKey) : null)),
    [group.legs],
  );

  useEffect(() => {
    if (!client || !publicKey || !group.resolved) {
      setClaimable(null);
      return;
    }
    let cancelled = false;
    client.flows
      .findClaimableLegs(legMarkets, publicKey)
      .then((found) => {
        if (cancelled) return;
        // Winning side per leg: the resolved leg pays its YES holders; every
        // other leg (and all legs when cancelled) pays its NO holders.
        setClaimable(
          found.map((c) => {
            const isYesWinner = group.winningLeg !== null && group.winningLeg === c.legIndex;
            return {
              legIndex: c.legIndex,
              name: group.legs[c.legIndex]?.name ?? `Leg #${c.legIndex}`,
              expectedPayout: isYesWinner ? c.yesBalance : c.noBalance,
            };
          }),
        );
      })
      .catch(() => !cancelled && setClaimable([]));
    return () => {
      cancelled = true;
    };
  }, [client, publicKey, group, legMarkets]);

  const totalMicroUsdc = (claimable ?? []).reduce((s, c) => s + c.expectedPayout, 0);

  const onClaim = async () => {
    if (!client || !publicKey || !claimable || claimable.length === 0) return;
    setLoading(true);
    try {
      const { legsClaimed } = await client.flows.claimAllGroupWinnings({
        legMarkets,
        onProgress: (label, i, n) => setProgress({ label, i, n }),
      });
      setProgress(null);
      toast.success(`Claimed ${legsClaimed} legs · ~${formatUsdc(totalMicroUsdc)} USDC`);
      setClaimable([]); // optimistic: positions consumed
    } catch (err) {
      setProgress(null);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("WalletSign") || msg.includes("User rejected")) {
        toast.info("Transaction cancelled");
      } else {
        toast.error("Claim failed", { description: msg.slice(0, 200) });
      }
    } finally {
      setLoading(false);
    }
  };

  return { claimable, progress, loading, totalMicroUsdc, onClaim };
}

function ResolvedClaimPanel({
  group,
  legs,
}: {
  group: GroupData;
  legs: { market: MarketData; idx: number }[];
}) {
  const state = useGroupClaimAll(group);
  const isCancelled = group.winningLeg === null;
  const winningLegMarket = legs.find((l) => l.idx === group.winningLeg)?.market;

  return (
    <div className="border border-line p-[16px] space-y-[12px]">
      <p className="text-caption">RESOLVED</p>
      <p className="text-[12px] font-mono">
        {isCancelled ? (
          <span className="text-muted">Cancelled · NO tokens valid on every leg</span>
        ) : (
          <>
            Winning:{" "}
            <span className="text-yes">{winningLegMarket?.name ?? `Leg #${group.winningLeg}`}</span>
          </>
        )}
      </p>
      <ClaimAllBody state={state} />
      {winningLegMarket && (
        <Link
          href={`/market/${winningLegMarket.marketId}`}
          className="block text-[11px] text-muted hover:text-text-hi font-mono pt-[4px]"
        >
          View winning leg →
        </Link>
      )}
    </div>
  );
}

function ClaimAllBody({ state }: { state: ClaimAllState }) {
  const { claimable, progress, loading, totalMicroUsdc, onClaim } = state;
  if (claimable === null) {
    return <p className="text-[11px] text-muted font-mono">Loading positions…</p>;
  }
  if (claimable.length === 0) {
    return <p className="text-[11px] text-muted font-mono">No claimable positions.</p>;
  }
  return (
    <>
      <div className="border-t border-line pt-[8px] space-y-[4px]">
        {claimable.map((c) => (
          <div key={c.legIndex} className="flex justify-between text-[11px] font-mono">
            <span className="text-muted truncate flex-1 mr-[8px]">{c.name}</span>
            <span className="text-text-hi tabular-nums">{formatUsdc(c.expectedPayout)} USDC</span>
          </div>
        ))}
        <div className="flex justify-between text-[12px] font-mono pt-[4px] border-t border-line">
          <span className="text-muted">Total</span>
          <span className="text-text-hi tabular-nums font-medium">
            {formatUsdc(totalMicroUsdc)} USDC
          </span>
        </div>
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
      <Button variant="yes" className="w-full" onClick={onClaim} disabled={loading}>
        {loading ? "Claiming…" : `Claim all (~${formatUsdc(totalMicroUsdc)} USDC)`}
      </Button>
    </>
  );
}
