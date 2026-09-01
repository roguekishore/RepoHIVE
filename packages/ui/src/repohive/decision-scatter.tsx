"use client";

/**
 * Decision scatter — every region plotted in the engine's own decision space.
 *
 * Axes are the two normalised terms the score is built from: squashed cohesion
 * (x) and independence, 1 − coupling (y). In this space the decision rule
 * wc·x + wp·y ≥ B·(wc+wp) is a straight line, so the boundary that decided
 * every region's fate is drawn exactly — regions above it preserved, below it
 * reconstructed. No other tool records this decision; this is the contribution
 * rendered in one picture.
 *
 * Encoding is shape + colour, never colour alone (handoff §10.3): preserved
 * regions are filled circles, reconstructed regions hollow diamonds. Dot area
 * tracks the region's file count. A counterfactual boundary (slider) redraws
 * the line and re-fills the dots; regions that would flip get a dashed halo.
 *
 * Deterministic: regions arrive canonically ordered and are rendered in that
 * order; there is no jitter and no randomness.
 */

import * as React from "react";
import { boundarySegment } from "./decision-model";
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
}

const W = 640;
const H = 420;
const PAD = { top: 18, right: 18, bottom: 42, left: 46 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const sx = (v: number) => PAD.left + v * PLOT_W;
const sy = (v: number) => PAD.top + (1 - v) * PLOT_H;

function dotRadius(fileCount: number): number {
  return Math.min(13, 4 + Math.sqrt(Math.max(0, fileCount)) * 1.15);
}

/** A diamond path centred on (cx, cy) with "radius" r. */
function diamondPath(cx: number, cy: number, r: number): string {
  return `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`;
}

const TICKS = [0, 0.25, 0.5, 0.75, 1];

export function DecisionScatter({
  regions,
  weights,
  boundary,
  recordedBoundary,
  selectedId,
  onSelect,
}: DecisionScatterProps) {
  const line = boundarySegment(boundary, weights);
  const recordedLine =
    Math.abs(boundary - recordedBoundary) > 1e-9 ? boundarySegment(recordedBoundary, weights) : null;

  const toggle = (regionId: string) => {
    onSelect?.(selectedId === regionId ? null : regionId);
  };

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="group"
        aria-label={`Decision scatter: ${regions.length} regions plotted by squashed cohesion and independence, split by the quality boundary.`}
      >
        {/* Plot frame + gridlines */}
        {TICKS.map((t) => (
          <g key={t}>
            <line
              x1={sx(t)}
              y1={sy(0)}
              x2={sx(t)}
              y2={sy(1)}
              stroke="var(--color-border-default)"
              strokeWidth={t === 0 ? 1 : 0.5}
            />
            <line
              x1={sx(0)}
              y1={sy(t)}
              x2={sx(1)}
              y2={sy(t)}
              stroke="var(--color-border-default)"
              strokeWidth={t === 0 ? 1 : 0.5}
            />
            <text
              x={sx(t)}
              y={sy(0) + 16}
              textAnchor="middle"
              className="fill-[var(--color-text-tertiary)] font-mono text-[10px]"
            >
              {t}
            </text>
            <text
              x={sx(0) - 8}
              y={sy(t) + 3}
              textAnchor="end"
              className="fill-[var(--color-text-tertiary)] font-mono text-[10px]"
            >
              {t}
            </text>
          </g>
        ))}

        {/* Axis titles */}
        <text
          x={sx(0.5)}
          y={H - 6}
          textAnchor="middle"
          className="fill-[var(--color-text-secondary)] text-[11px]"
        >
          cohesion, squashed c∕(c+k) →
        </text>
        <text
          x={12}
          y={sy(0.5)}
          textAnchor="middle"
          transform={`rotate(-90 12 ${sy(0.5)})`}
          className="fill-[var(--color-text-secondary)] text-[11px]"
        >
          independence, 1 − coupling →
        </text>

        {/* The recorded boundary, ghosted while a counterfactual is applied */}
        {recordedLine && (
          <line
            x1={sx(recordedLine.x1)}
            y1={sy(recordedLine.y1)}
            x2={sx(recordedLine.x2)}
            y2={sy(recordedLine.y2)}
            stroke="var(--color-text-tertiary)"
            strokeWidth={1}
            strokeDasharray="2 4"
            opacity={0.6}
          />
        )}

        {/* The decision boundary */}
        {line ? (
          <g>
            <line
              x1={sx(line.x1)}
              y1={sy(line.y1)}
              x2={sx(line.x2)}
              y2={sy(line.y2)}
              stroke="var(--color-text-primary)"
              strokeWidth={1.5}
              strokeDasharray="7 4"
            />
            <text
              x={sx(Math.min(1, (line.x1 + line.x2) / 2) ) + 6}
              y={sy((line.y1 + line.y2) / 2) - 6}
              className="fill-[var(--color-text-secondary)] font-mono text-[10px]"
            >
              boundary {boundary.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}
            </text>
          </g>
        ) : (
          <text
            x={sx(0.5)}
            y={sy(1) - 4}
            textAnchor="middle"
            className="fill-[var(--color-text-tertiary)] text-[10px]"
          >
            boundary line not drawable in two dimensions (a modularity weight was applied)
          </text>
        )}

        {/* Region marks — canonical order, selected drawn with a ring */}
        {regions.map((region) => {
          const cx = sx(region.cohesionNorm);
          const cy = sy(region.independence);
          const r = dotRadius(region.fileCount);
          const preserved = region.effectiveAction === "preserve";
          const selected = selectedId === region.regionId;
          const title = `${region.label} — ${region.effectiveAction}${
            region.flipped ? " (would flip)" : ""
          }${region.userOverridden ? " (overridden)" : ""} · score ${region.score} · ${
            region.fileCount
          } files`;
          return (
            <g
              key={region.regionId}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={title}
              className="cursor-pointer outline-none focus-visible:[&>*:first-child]:stroke-[var(--color-accent-primary)]"
              onClick={() => toggle(region.regionId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(region.regionId);
                }
              }}
            >
              {/* Halo: selection ring, or dashed flip ring */}
              <circle
                cx={cx}
                cy={cy}
                r={r + 4.5}
                fill="none"
                stroke={
                  selected
                    ? "var(--color-accent-primary)"
                    : region.flipped
                      ? "var(--color-text-secondary)"
                      : "transparent"
                }
                strokeWidth={selected ? 2 : 1.25}
                strokeDasharray={selected ? undefined : region.flipped ? "3 3" : undefined}
              />
              {preserved ? (
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="var(--color-success)"
                  fillOpacity={0.85}
                  stroke="var(--color-bg-surface)"
                  strokeWidth={1.25}
                />
              ) : (
                <path
                  d={diamondPath(cx, cy, r + 1)}
                  fill="var(--color-bg-surface)"
                  stroke="var(--color-warning)"
                  strokeWidth={2}
                />
              )}
              <title>{title}</title>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
        <span className="inline-flex items-center gap-1.5">
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
            <circle cx="6" cy="6" r="4.5" fill="var(--color-success)" fillOpacity={0.85} />
          </svg>
          preserved
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
            <path d={diamondPath(6, 6, 4.5)} fill="none" stroke="var(--color-warning)" strokeWidth={1.75} />
          </svg>
          reconstructed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
            <circle cx="6" cy="6" r="4.5" fill="none" stroke="var(--color-text-secondary)" strokeDasharray="2 2" />
          </svg>
          would flip at this boundary
        </span>
        <span>dot area tracks file count</span>
      </figcaption>
    </figure>
  );
}
