"use client";

/**
 * Decision scatter — every region plotted in the engine's own decision space.
 *
 * Axes are the two normalised terms the score is built from: squashed cohesion
 * (x) and independence, 1 − coupling (y). In this space the decision rule
 * wc·x + wp·y ≥ B·(wc+wp) is a straight line, so the boundary that decided
 * every region's fate is drawn exactly. No other tool records this decision;
 * this is the contribution rendered in one picture.
 *
 * Three states, three channels (colour, shape, word) — see `decision-mark`.
 * Degenerate regions are plotted because their coordinates are recorded, but
 * they read as absent data and never move with the boundary.
 *
 * Axes scale to the data rather than to [0,1] for tidiness, with the boundary
 * line kept in frame; a stated render budget caps the mark count and the
 * truncation announces itself.
 *
 * Deterministic: regions arrive canonically ordered and are rendered in that
 * order; the budget drops the least-marginal regions with an id tie-break.
 * There is no jitter and no randomness.
 */

import * as React from "react";
import { boundarySegment } from "./decision-model";
import { DecisionLegend, DecisionMarkShape } from "./decision-mark";
import { displayNumber } from "./format";
import type { DecisionWeights, RegionView } from "./types";

export interface DecisionScatterProps {
  regions: readonly RegionView[];
  weights: DecisionWeights;
  /** The boundary currently applied (may be the slider's counterfactual). */
  boundary: number;
  /** The boundary the engine actually ran with. */
  recordedBoundary: number;
  selectedId?: string | null;
  onSelect?: (regionId: string | null) => void;
  /** Marks drawn before the view truncates to the most marginal regions. */
  budget?: number;
}

/** Above this many marks the plot is unreadable before it is slow. */
export const SCATTER_BUDGET = 500;

const W = 640;
const H = 430;
const PAD = { top: 20, right: 20, bottom: 44, left: 48 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function dotRadius(fileCount: number): number {
  return Math.min(13, 4 + Math.sqrt(Math.max(0, fileCount)) * 1.15);
}

/** Round a domain maximum up to a clean tick so the axis reads deliberately. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  for (const step of [0.05, 0.1, 0.2, 0.25, 0.5, 1]) {
    const rounded = Math.ceil(value / step) * step;
    if (rounded >= value && rounded / step <= 6) return Math.min(1, Number(rounded.toFixed(4)));
  }
  return 1;
}

/** Evenly spaced ticks across [0, max], including both ends. */
function ticksFor(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => Number(((max / count) * i).toFixed(4)));
}

export function DecisionScatter({
  regions,
  weights,
  boundary,
  recordedBoundary,
  selectedId,
  onSelect,
  budget = SCATTER_BUDGET,
}: DecisionScatterProps) {
  // --- Render budget: keep the most marginal regions, which are the ones the
  // boundary argument is about. Deterministic, id tie-broken.
  const shown = React.useMemo(() => {
    if (regions.length <= budget) return regions;
    return [...regions]
      .sort(
        (a, b) =>
          Math.abs(a.score - boundary) - Math.abs(b.score - boundary) ||
          (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0),
      )
      .slice(0, budget)
      .sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0));
  }, [regions, budget, boundary]);
  const dropped = regions.length - shown.length;

  // --- Domains scaled to the data, with the boundary intercepts kept in frame.
  const { xMax, yMax } = React.useMemo(() => {
    let x = 0;
    let y = 0;
    for (const r of shown) {
      if (r.cohesionNorm > x) x = r.cohesionNorm;
      if (r.independence > y) y = r.independence;
    }
    // The boundary line must stay visible: at equal weights it crosses the axes
    // at 2·boundary, so keep at least a little past whichever intercept lands
    // inside the unit square.
    const intercept = Math.min(1, 2 * boundary);
    return {
      xMax: niceMax(Math.max(x * 1.12, Math.min(intercept, 0.6), 0.2)),
      yMax: niceMax(Math.max(y * 1.18, Math.min(intercept, 0.6), 0.2)),
    };
  }, [shown, boundary]);

  const sx = (v: number) => PAD.left + (v / xMax) * PLOT_W;
  const sy = (v: number) => PAD.top + (1 - v / yMax) * PLOT_H;

  const line = boundarySegment(boundary, weights);
  const recorded =
    Math.abs(boundary - recordedBoundary) > 1e-9 ? boundarySegment(recordedBoundary, weights) : null;

  /** Clip a boundary segment to the visible window, in data space. */
  const clip = (seg: { x1: number; y1: number; x2: number; y2: number } | null) => {
    if (!seg) return null;
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    let t0 = 0;
    let t1 = 1;
    const slab = (p: number, q: number) => {
      // p·t ≤ q for each of the four window edges
      if (Math.abs(p) < 1e-12) return q >= 0;
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      return true;
    };
    const ok =
      slab(-dx, seg.x1 - 0) &&
      slab(dx, xMax - seg.x1) &&
      slab(-dy, seg.y1 - 0) &&
      slab(dy, yMax - seg.y1);
    if (!ok || t0 > t1) return null;
    return {
      x1: seg.x1 + dx * t0,
      y1: seg.y1 + dy * t0,
      x2: seg.x1 + dx * t1,
      y2: seg.y1 + dy * t1,
    };
  };
  const visible = clip(line);
  const visibleRecorded = clip(recorded);

  const toggle = (regionId: string) => {
    onSelect?.(selectedId === regionId ? null : regionId);
  };

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="group"
        aria-label={`Decision scatter: ${shown.length} regions plotted by squashed cohesion and independence, split by the quality boundary of ${displayNumber(boundary)}.`}
      >
        {ticksFor(xMax).map((t) => (
          <g key={`x${t}`}>
            <line
              x1={sx(t)}
              y1={sy(0)}
              x2={sx(t)}
              y2={PAD.top}
              stroke="var(--color-border-default)"
              strokeWidth={t === 0 ? 1 : 0.5}
            />
            <text
              x={sx(t)}
              y={sy(0) + 16}
              textAnchor="middle"
              className="fill-[var(--color-text-tertiary)] font-mono text-[10px] tabular-nums"
            >
              {t}
            </text>
          </g>
        ))}
        {ticksFor(yMax).map((t) => (
          <g key={`y${t}`}>
            <line
              x1={sx(0)}
              y1={sy(t)}
              x2={sx(xMax)}
              y2={sy(t)}
              stroke="var(--color-border-default)"
              strokeWidth={t === 0 ? 1 : 0.5}
            />
            <text
              x={sx(0) - 8}
              y={sy(t) + 3}
              textAnchor="end"
              className="fill-[var(--color-text-tertiary)] font-mono text-[10px] tabular-nums"
            >
              {t}
            </text>
          </g>
        ))}

        <text
          x={sx(xMax / 2)}
          y={H - 6}
          textAnchor="middle"
          className="fill-[var(--color-text-secondary)] text-[11px]"
        >
          cohesion, squashed c∕(c+k) →
        </text>
        <text
          x={13}
          y={sy(yMax / 2)}
          textAnchor="middle"
          transform={`rotate(-90 13 ${sy(yMax / 2)})`}
          className="fill-[var(--color-text-secondary)] text-[11px]"
        >
          independence, 1 − coupling →
        </text>

        {/* The recorded boundary, ghosted while a counterfactual is applied */}
        {visibleRecorded && (
          <line
            x1={sx(visibleRecorded.x1)}
            y1={sy(visibleRecorded.y1)}
            x2={sx(visibleRecorded.x2)}
            y2={sy(visibleRecorded.y2)}
            stroke="var(--color-text-tertiary)"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        )}

        {/* The boundary itself — the one amber mark on the plot */}
        {visible ? (
          <g>
            <line
              x1={sx(visible.x1)}
              y1={sy(visible.y1)}
              x2={sx(visible.x2)}
              y2={sy(visible.y2)}
              stroke="var(--color-decision-boundary)"
              strokeWidth={1.5}
              strokeDasharray="7 4"
            />
            <text
              x={sx((visible.x1 + visible.x2) / 2) + 8}
              y={sy((visible.y1 + visible.y2) / 2) - 7}
              className="fill-[var(--color-decision-boundary)] font-mono text-[10px] tabular-nums"
            >
              boundary {displayNumber(boundary)}
            </text>
          </g>
        ) : (
          <text
            x={sx(xMax / 2)}
            y={PAD.top + 12}
            textAnchor="middle"
            className="fill-[var(--color-text-tertiary)] text-[10px]"
          >
            {weights.modularity !== undefined
              ? "boundary not drawable in two dimensions (a modularity weight was applied)"
              : "boundary lies outside the plotted range"}
          </text>
        )}

        {/* Region marks — canonical order */}
        {shown.map((region) => {
          const cx = sx(region.cohesionNorm);
          const cy = sy(region.independence);
          const r = dotRadius(region.fileCount);
          const selected = selectedId === region.regionId;
          const title = `${region.label} — ${
            region.degenerate ? "not assessed (scored 0 by rule)" : region.effectiveAction
          }${region.flipped ? " · would flip here" : ""}${
            region.userOverridden ? " · overridden" : ""
          } · score ${displayNumber(region.score)} · ${region.fileCount} files`;
          return (
            <g
              key={region.regionId}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={title}
              className="cursor-pointer outline-none focus-visible:[&>circle:first-child]:stroke-[var(--color-decision-boundary)]"
              onClick={() => toggle(region.regionId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(region.regionId);
                }
              }}
            >
              <circle
                cx={cx}
                cy={cy}
                r={r + 4.5}
                fill="none"
                stroke={
                  selected
                    ? "var(--color-decision-boundary)"
                    : region.flipped
                      ? "var(--color-text-secondary)"
                      : "transparent"
                }
                strokeWidth={selected ? 2 : 1.25}
                strokeDasharray={selected ? undefined : region.flipped ? "3 3" : undefined}
              />
              <DecisionMarkShape state={region.state} cx={cx} cy={cy} size={r} />
              <title>{title}</title>
            </g>
          );
        })}
      </svg>

      <figcaption className="mt-2 space-y-1.5">
        <DecisionLegend />
        <p className="text-[11px] text-[var(--color-text-tertiary)]">
          Mark area tracks file count. Dashed ring = would flip at this boundary. Axes scaled to the
          data (x to {xMax}, y to {yMax}), not to 1.
          {dropped > 0 && (
            <>
              {" "}
              Showing the {shown.length} most marginal of {regions.length} regions;{" "}
              <strong className="font-medium text-[var(--color-text-secondary)]">
                {dropped} not drawn
              </strong>
              .
            </>
          )}
        </p>
      </figcaption>
    </figure>
  );
}
