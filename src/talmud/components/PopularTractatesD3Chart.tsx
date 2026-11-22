import React, { useMemo, useState } from "react";
import * as d3 from "d3";
import { motion } from "motion/react";
import { TrendingUp, ArrowUpRight } from "lucide-react";
import type { AppTheme } from "../types/talmud";
import type { TopTractateStat } from "../utils/tractateSearchStats";

interface PopularTractatesD3ChartProps {
  stats: TopTractateStat[];
  onSelectTractate: (tractateId: string) => void;
  theme?: AppTheme;
  isDark?: boolean;
}

interface PackRootDatum {
  children: TopTractateStat[];
}

const CHART_WIDTH = 340;
const CHART_HEIGHT = 176;

const PALETTE_DARK = [
  { fill: "#F59E0B", edge: "#FDE68A", text: "#FEF3C7", sub: "#FDE68A" },
  { fill: "#38BDF8", edge: "#BAE6FD", text: "#E0F2FE", sub: "#BAE6FD" },
  { fill: "#A855F7", edge: "#E9D5FF", text: "#F3E8FF", sub: "#DDD6FE" },
  { fill: "#10B981", edge: "#A7F3D0", text: "#ECFDF5", sub: "#A7F3D0" },
  { fill: "#FB7185", edge: "#FECDD3", text: "#FFF1F2", sub: "#FECDD3" },
];

const PALETTE_LIGHT = [
  { fill: "#D97706", edge: "#92400E", text: "#2C180B", sub: "#78350F" },
  { fill: "#0284C7", edge: "#075985", text: "#0C2D48", sub: "#0369A1" },
  { fill: "#7C3AED", edge: "#5B21B6", text: "#2E1065", sub: "#6D28D9" },
  { fill: "#059669", edge: "#065F46", text: "#064E3B", sub: "#047857" },
  { fill: "#E11D48", edge: "#9F1239", text: "#4C0519", sub: "#BE123C" },
];

export const PopularTractatesD3Chart: React.FC<PopularTractatesD3ChartProps> = ({
  stats,
  onSelectTractate,
  theme = "sanctuary-3d",
  isDark = true,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const isCelestial = theme === "celestial-slate";
  const palette = isDark && !isCelestial ? PALETTE_DARK : PALETTE_LIGHT;

  const packedNodes = useMemo(() => {
    if (!stats.length) return [];
    const hierarchy = d3
      .hierarchy<PackRootDatum | TopTractateStat>({ children: stats })
      .sum((d) => ("count" in d ? Math.max(d.count, 1) : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const packLayout = d3
      .pack<PackRootDatum | TopTractateStat>()
      .size([CHART_WIDTH, CHART_HEIGHT])
      .padding(8);

    const packed = packLayout(hierarchy);
    const fallbackColors = palette[0] ?? {
      fill: "#F59E0B",
      edge: "#FDE68A",
      text: "#FEF3C7",
      sub: "#FDE68A",
    };
    return packed.leaves().map((leaf, idx) => {
      const datum = leaf.data as TopTractateStat;
      return {
        ...datum,
        x: leaf.x,
        y: leaf.y,
        r: leaf.r,
        rank: idx + 1,
        colors: palette[idx % palette.length] ?? fallbackColors,
      };
    });
  }, [stats, palette]);

  const activeStat = useMemo(() => {
    if (!packedNodes.length) return null;
    if (!hoveredId) return packedNodes[0];
    return packedNodes.find((n) => n.tractateId === hoveredId) ?? packedNodes[0];
  }, [packedNodes, hoveredId]);

  if (!stats.length) return null;

  return (
    <div
      data-d3-tractates-chart="true"
      className={`rounded-2xl border px-3 py-2.5 transition-colors ${
        isCelestial
          ? "bg-white/75 border-[#94B8DC]/70 text-[#1E293B]"
          : isDark
            ? "bg-[#241912]/90 border-[#4A3322] text-[#FAF5EB]"
            : "bg-white/85 border-[#D6C4AD] text-[#2C180B]"
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <TrendingUp
            className={`w-3.5 h-3.5 shrink-0 ${isCelestial ? "text-sky-600" : "text-amber-500"}`}
          />
          <span className="text-[11px] font-extrabold tracking-tight truncate">
            ბოლო 30 დღის ტოპ 5 ტრაქტატი
          </span>
        </div>
        {activeStat && (
          <button
            type="button"
            data-raw-btn="true"
            data-flat-btn="true"
            onClick={() => onSelectTractate(activeStat.tractateId)}
            className={`inline-flex items-center gap-1 text-[10.5px] font-bold cursor-pointer transition-opacity hover:opacity-80 shrink-0 tabular-nums ${
              isCelestial ? "text-sky-700" : isDark ? "text-amber-300" : "text-amber-800"
            }`}
          >
            <span>
              {activeStat.shortNameKa} · {activeStat.count} ძიება ({activeStat.sharePct}%)
            </span>
            <ArrowUpRight className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="w-full flex flex-col sm:flex-row items-center gap-2">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="img"
          aria-label="ბოლო 30 დღის ტოპ 5 ძიებული ტრაქტატის D3 დიაგრამა"
          className="w-full max-w-[340px] h-[168px] overflow-visible select-none shrink-0"
        >
          <defs>
            {packedNodes.map((node) => (
              <radialGradient
                key={`grad-${node.tractateId}`}
                id={`d3-tractate-bubble-${node.tractateId}`}
                cx="35%"
                cy="28%"
                r="70%"
              >
                <stop
                  offset="0%"
                  stopColor={node.colors.fill}
                  stopOpacity={isDark && !isCelestial ? 0.55 : 0.34}
                />
                <stop
                  offset="100%"
                  stopColor={node.colors.fill}
                  stopOpacity={isDark && !isCelestial ? 0.22 : 0.14}
                />
              </radialGradient>
            ))}
          </defs>
          {packedNodes.map((node, i) => {
            const isActive = hoveredId === node.tractateId;
            const showHebrew = node.r >= 27;
            const showCount = node.r >= 22;
            const nameFontSize = Math.max(8.5, Math.min(11.5, node.r * 0.25));
            const heFontSize = Math.max(8, Math.min(11, node.r * 0.22));
            return (
              <motion.g
                key={node.tractateId}
                initial={{ opacity: 0, scale: 0.72 }}
                animate={{
                  opacity: 1,
                  scale: isActive ? 1.06 : 1,
                }}
                transition={{
                  duration: 0.34,
                  delay: i * 0.05,
                  ease: [0.16, 1, 0.3, 1],
                }}
                style={{
                  transformOrigin: `${node.x}px ${node.y}px`,
                  cursor: "pointer",
                }}
                role="button"
                tabIndex={0}
                aria-label={`${node.nameKa} — ${node.count} ძიება ბოლო 30 დღეში`}
                onMouseEnter={() => setHoveredId(node.tractateId)}
                onFocus={() => setHoveredId(node.tractateId)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onSelectTractate(node.tractateId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectTractate(node.tractateId);
                  }
                }}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  fill={`url(#d3-tractate-bubble-${node.tractateId})`}
                  stroke={node.colors.edge}
                  strokeWidth={isActive ? 2.2 : 1.3}
                  strokeOpacity={isActive ? 0.95 : 0.7}
                />
                <text
                  x={node.x}
                  y={showHebrew ? node.y - node.r * 0.14 : node.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={node.colors.text}
                  fontSize={nameFontSize}
                  fontWeight={800}
                >
                  {node.shortNameKa}
                </text>
                {showHebrew && (
                  <text
                    x={node.x}
                    y={node.y + node.r * 0.16}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={node.colors.sub}
                    fontSize={heFontSize}
                    fontWeight={700}
                    style={{ fontFamily: "serif" }}
                  >
                    {node.nameHe}
                  </text>
                )}
                {showCount && (
                  <text
                    x={node.x}
                    y={showHebrew ? node.y + node.r * 0.44 : node.y + node.r * 0.32}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={node.colors.sub}
                    fontSize={9}
                    fontWeight={700}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {node.count}
                  </text>
                )}
              </motion.g>
            );
          })}
        </svg>

        <div className="w-full flex-1 min-w-0 flex sm:flex-col flex-wrap gap-1.5">
          {packedNodes.map((node) => {
            const isActive = activeStat?.tractateId === node.tractateId;
            return (
              <button
                key={`legend-${node.tractateId}`}
                type="button"
                data-raw-btn="true"
                data-flat-btn="true"
                onMouseEnter={() => setHoveredId(node.tractateId)}
                onFocus={() => setHoveredId(node.tractateId)}
                onClick={() => onSelectTractate(node.tractateId)}
                className={`flex items-center justify-between gap-2 px-2 py-1 rounded-lg border text-[10.5px] cursor-pointer transition-colors min-w-[120px] flex-1 sm:flex-none ${
                  isActive
                    ? isCelestial
                      ? "bg-sky-50 border-sky-400 text-sky-950"
                      : isDark
                        ? "bg-amber-500/18 border-amber-400/70 text-amber-100"
                        : "bg-amber-100/80 border-amber-500 text-amber-950"
                    : isCelestial
                      ? "bg-slate-50/70 border-slate-200 hover:bg-sky-50/70 text-slate-700"
                      : isDark
                        ? "bg-black/20 border-white/10 hover:bg-white/8 text-stone-200"
                        : "bg-amber-50/40 border-[#E2D4C3] hover:bg-amber-50 text-stone-800"
                }`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: node.colors.fill }}
                  />
                  <span className="font-bold truncate">{node.shortNameKa}</span>
                </span>
                <span className="font-semibold opacity-80 tabular-nums shrink-0">
                  {node.count} · {node.sharePct}%
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
