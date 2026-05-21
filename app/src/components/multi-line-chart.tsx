"use client";

import { useMemo, useState } from "react";

export interface Series {
  /** Display label (e.g. leg name). */
  label: string;
  /** Hex / CSS color string used for both the line and the legend chip. */
  color: string;
  /** Historical points, oldest → newest. Values in [0, 1] (probabilities). */
  points: number[];
  /** Optional identifier passed back via onHover. */
  id?: string;
}

interface MultiLineChartProps {
  series: Series[];
  /** Chart width in CSS px. Default 800. */
  width?: number;
  /** Chart height in CSS px. Default 220. */
  height?: number;
  /** Show a horizontal midline at 0.5. Default false. */
  midline?: boolean;
  /** Highlight one series (others dimmed). */
  highlightId?: string;
  /** Called when the user hovers over the chart with the closest point. */
  onHover?: (i: number | null) => void;
}

const PAD_T = 16;
const PAD_R = 8;
const PAD_B = 24;
const PAD_L = 36;

interface ChartGeom {
  toX: (i: number) => number;
  toY: (v: number) => number;
  chartW: number;
  chartH: number;
  yMin: number;
  yMax: number;
  maxLen: number;
}

function computeGeom(series: Series[], width: number, height: number): ChartGeom {
  const maxLen = Math.max(0, ...series.map((s) => s.points.length));
  const chartW = width - PAD_L - PAD_R;
  const chartH = height - PAD_T - PAD_B;
  const allValues = series.flatMap((s) => s.points);
  const yMin = allValues.length ? Math.max(0, Math.min(...allValues) - 0.05) : 0;
  const yMax = allValues.length ? Math.min(1, Math.max(...allValues) + 0.05) : 1;
  const yRange = yMax - yMin || 0.1;
  const toX = (i: number) => PAD_L + (maxLen <= 1 ? chartW / 2 : (i / (maxLen - 1)) * chartW);
  const toY = (v: number) => PAD_T + chartH - ((v - yMin) / yRange) * chartH;
  return { toX, toY, chartW, chartH, yMin, yMax, maxLen };
}

export function MultiLineChart({
  series,
  width = 800,
  height = 220,
  midline = false,
  highlightId,
  onHover,
}: MultiLineChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const geom = useMemo(() => computeGeom(series, width, height), [series, width, height]);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!geom.maxLen) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD_L) / geom.chartW));
    const idx = Math.round(ratio * (geom.maxLen - 1));
    setHoverIdx(idx);
    onHover?.(idx);
  };

  const handleLeave = () => {
    setHoverIdx(null);
    onHover?.(null);
  };

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full max-w-full overflow-visible"
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <ChartGrid geom={geom} width={width} midline={midline} />
      <ChartLines series={series} geom={geom} highlightId={highlightId} />
      <ChartCrosshair series={series} geom={geom} hoverIdx={hoverIdx} height={height} />
    </svg>
  );
}

function ChartGrid({ geom, width, midline }: { geom: ChartGeom; width: number; midline: boolean }) {
  const ticks = [geom.yMin, (geom.yMin + geom.yMax) / 2, geom.yMax];
  return (
    <>
      {ticks.map((v, i) => (
        <g key={i}>
          <line
            x1={PAD_L}
            x2={width - PAD_R}
            y1={geom.toY(v)}
            y2={geom.toY(v)}
            stroke="var(--line)"
            strokeDasharray="2 4"
          />
          <text
            x={PAD_L - 6}
            y={geom.toY(v) + 3}
            fontSize="9"
            textAnchor="end"
            fill="var(--muted)"
            fontFamily="var(--font-mono, monospace)"
          >
            {(v * 100).toFixed(0)}%
          </text>
        </g>
      ))}
      {midline && (
        <line
          x1={PAD_L}
          x2={width - PAD_R}
          y1={geom.toY(0.5)}
          y2={geom.toY(0.5)}
          stroke="var(--line-2)"
          strokeWidth="1"
        />
      )}
    </>
  );
}

function ChartLines({
  series,
  geom,
  highlightId,
}: {
  series: Series[];
  geom: ChartGeom;
  highlightId: string | undefined;
}) {
  return (
    <>
      {series.map((s) => {
        if (s.points.length < 2) return null;
        const d = s.points
          .map(
            (v, i) => `${i === 0 ? "M" : "L"} ${geom.toX(i).toFixed(1)} ${geom.toY(v).toFixed(1)}`,
          )
          .join(" ");
        const dim = highlightId !== undefined && highlightId !== s.id;
        return (
          <path
            key={s.label}
            d={d}
            fill="none"
            stroke={s.color}
            strokeWidth={dim ? "1" : "1.5"}
            strokeOpacity={dim ? 0.3 : 1}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}
    </>
  );
}

function ChartCrosshair({
  series,
  geom,
  hoverIdx,
  height,
}: {
  series: Series[];
  geom: ChartGeom;
  hoverIdx: number | null;
  height: number;
}) {
  if (hoverIdx === null || geom.maxLen === 0) return null;
  return (
    <g>
      <line
        x1={geom.toX(hoverIdx)}
        x2={geom.toX(hoverIdx)}
        y1={PAD_T}
        y2={height - PAD_B}
        stroke="var(--text-dim)"
        strokeOpacity="0.4"
        strokeWidth="1"
      />
      {series.map((s) => {
        const v = s.points[hoverIdx];
        if (v === undefined) return null;
        return (
          <circle
            key={s.label}
            cx={geom.toX(hoverIdx)}
            cy={geom.toY(v)}
            r={3}
            fill={s.color}
            stroke="var(--bg)"
            strokeWidth="1"
          />
        );
      })}
    </g>
  );
}

/**
 * Deterministic color palette for series. Stable across renders for the same
 * index. Picked to read well on a dark background.
 */
export const SERIES_PALETTE = [
  "#60a5fa", // blue-400
  "#fbbf24", // amber-400
  "#fb923c", // orange-400
  "#f87171", // red-400
  "#a78bfa", // violet-400
  "#34d399", // emerald-400
  "#22d3ee", // cyan-400
  "#f472b6", // pink-400
  "#facc15", // yellow-400
  "#94a3b8", // slate-400
  "#fb7185", // rose-400
  "#4ade80", // green-400
  "#c084fc", // purple-400
  "#fde68a", // amber-200
  "#a3e635", // lime-400
  "#67e8f9", // cyan-300
];

export function seriesColor(i: number): string {
  return SERIES_PALETTE[i % SERIES_PALETTE.length];
}
