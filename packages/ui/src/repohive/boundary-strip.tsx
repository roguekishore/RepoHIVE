"use client";

/**
 * Boundary strip — all regions on one score axis, with the quality boundary
 * as a draggable line.
 *
 * The decision rule is `score ≥ boundary → preserve`, and both the per-region
 * score and the boundary are recorded, so dragging the line and watching
 * regions flip is pure arithmetic over recorded values — no re-run (handoff
 * §9 idea 2). The strip states its honest limit in the caption: a
 * counterfactual boundary shows *which regions would flip*, not the hierarchy
 * a re-run would produce.
 *
 * The slider is a real `<input type=range>` (keyboard- and screen-reader-
 * native) stretched invisibly across the axis; the visible line and handle
 * render from its value. Marks share the scatter's shape language: filled
 * circle = preserve, hollow diamond = reconstruct; overridden regions are
 * pinned and drawn with a lock glyph.
 *
 * Deterministic: marks stack within fixed score bins in canonical order.
 */

import * as React from "react";
import { tallyViews } from "./decision-model";
import type { RegionView } from "./types";

export interface BoundaryStripProps {
  regions: readonly RegionView[];
  boundary: number;
  recordedBoundary: number;
  onBoundaryChange: (boundary: number) => void;
  selectedId?: string | null;
  onSelect?: (regionId: string | null) => void;
}

const W = 960;
const AXIS_Y = 148;
const PAD_X = 20;
const H = 196;
const R = 6.5;

const xOf = (score: number) => PAD_X + score * (W - 2 * PAD_X);

/** Deterministic stacking: marks in the same 0.02-wide bin pile upward. */
function stackOffsets(regions: readonly RegionView[]): Map<string, number> {
  const seen = new Map<string, number>();
  const offsets = new Map<string, number>();
  for (const region of regions) {
    const bin = Math.round(region.score * 50);
    const level = seen.get(String(bin)) ?? 0;
    seen.set(String(bin), level + 1);
    offsets.set(region.regionId, level);
  }
  return offsets;
}

function diamondPath(cx: number, cy: number, r: number): string {
  return `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`;
}

function fmt(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

export function BoundaryStrip({
  regions,
  boundary,
  recordedBoundary,
  onBoundaryChange,
  selectedId,
  onSelect,
}: BoundaryStripProps) {
  const tally = tallyViews(regions);
  const counterfactual = Math.abs(boundary - recordedBoundary) > 1e-9;
  const offsets = stackOffsets(regions);
  const bx = xOf(boundary);

  const toggle = (regionId: string) => {
    onSelect?.(selectedId === regionId ? null : regionId);
  };

  return (
    <div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full select-none"
          role="group"
          aria-label={`Boundary strip: ${regions.length} regions ordered by structural-quality score.`}
        >
          {/* Sides of the boundary, washed */}
          <rect
            x={PAD_X}
            y={AXIS_Y - 120}
            width={Math.max(0, bx - PAD_X)}
            height={120}
            fill="var(--color-warning)"
            opacity={0.05}
          />
          <rect
            x={bx}
            y={AXIS_Y - 120}
            width={Math.max(0, W - PAD_X - bx)}
            height={120}
            fill="var(--color-success)"
            opacity={0.05}
          />

          {/* Axis */}
          <line
            x1={PAD_X}
            y1={AXIS_Y}
            x2={W - PAD_X}
            y2={AXIS_Y}
            stroke="var(--color-border-active)"
            strokeWidth={1}
          />
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line
                x1={xOf(t)}
                y1={AXIS_Y}
                x2={xOf(t)}
                y2={AXIS_Y + 5}
                stroke="var(--color-border-active)"
              />
              <text
                x={xOf(t)}
                y={AXIS_Y + 18}
                textAnchor="middle"
                className="fill-[var(--color-text-tertiary)] font-mono text-[10px]"
              >
                {t}
              </text>
            </g>
          ))}
          <text
            x={W - PAD_X}
            y={AXIS_Y + 34}
            textAnchor="end"
            className="fill-[var(--color-text-tertiary)] text-[10px]"
          >
            structural-quality score →
          </text>
          <text
            x={PAD_X}
            y={AXIS_Y - 126}
            className="fill-[var(--color-warning)] text-[10px] font-medium"
          >
            reconstruct ←
          </text>
          <text
            x={W - PAD_X}
            y={AXIS_Y - 126}
            textAnchor="end"
            className="fill-[var(--color-success)] text-[10px] font-medium"
          >
            → preserve
          </text>

          {/* Recorded boundary tick, ghosted when a counterfactual is applied */}
          {counterfactual && (
            <g>
              <line
                x1={xOf(recordedBoundary)}
                y1={AXIS_Y - 118}
                x2={xOf(recordedBoundary)}
                y2={AXIS_Y}
                stroke="var(--color-text-tertiary)"
                strokeDasharray="2 4"
              />
              <text
                x={xOf(recordedBoundary)}
                y={AXIS_Y - 108}
                textAnchor="middle"
                className="fill-[var(--color-text-tertiary)] font-mono text-[9px]"
              >
                recorded {fmt(recordedBoundary)}
              </text>
            </g>
          )}

          {/* Region marks */}
          {regions.map((region) => {
            const cx = xOf(region.score);
            const cy = AXIS_Y - 16 - (offsets.get(region.regionId) ?? 0) * 17;
            const preserved = region.effectiveAction === "preserve";
            const selected = selectedId === region.regionId;
            const title = `${region.label} — score ${region.score} · ${region.effectiveAction}${
              region.flipped ? " (flips here)" : ""
            }${region.userOverridden ? " (overridden, pinned)" : ""}`;
            return (
              <g
                key={region.regionId}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={title}
                className="cursor-pointer outline-none"
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
                  r={R + 3.5}
                  fill="none"
                  stroke={
                    selected
                      ? "var(--color-accent-primary)"
                      : region.flipped
                        ? "var(--color-text-secondary)"
                        : "transparent"
                  }
                  strokeWidth={selected ? 2 : 1}
                  strokeDasharray={selected ? undefined : region.flipped ? "2.5 2.5" : undefined}
                />
                {preserved ? (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={R}
                    fill="var(--color-success)"
                    fillOpacity={0.85}
                    stroke="var(--color-bg-surface)"
                    strokeWidth={1}
                  />
                ) : (
                  <path
                    d={diamondPath(cx, cy, R + 1)}
                    fill="var(--color-bg-surface)"
                    stroke="var(--color-warning)"
                    strokeWidth={1.75}
                  />
                )}
                {region.userOverridden && (
                  <text
                    x={cx}
                    y={cy - R - 5}
                    textAnchor="middle"
                    className="fill-[var(--color-text-tertiary)] text-[8px]"
                    aria-hidden
                  >
                    ⏚
                  </text>
                )}
                <title>{title}</title>
              </g>
            );
          })}

          {/* The boundary line + handle (visual layer of the range input) */}
          <g aria-hidden>
            <line
              x1={bx}
              y1={AXIS_Y - 120}
              x2={bx}
              y2={AXIS_Y + 6}
              stroke="var(--color-text-primary)"
              strokeWidth={1.5}
              strokeDasharray="6 3"
            />
            <rect
              x={bx - 21}
              y={AXIS_Y + 8}
              width={42}
              height={17}
              rx={4}
              fill="var(--color-text-primary)"
            />
            <text
              x={bx}
              y={AXIS_Y + 20}
              textAnchor="middle"
              className="fill-[var(--color-bg-surface)] font-mono text-[10px]"
            >
              {fmt(boundary)}
            </text>
          </g>
        </svg>

        {/* The real control: an invisible full-width range over the axis band.
            Keyboard and screen-reader users get a native slider. */}
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={boundary}
          onChange={(e) => onBoundaryChange(Number(e.target.value))}
          aria-label="Quality boundary (counterfactual — regrouping is not recomputed)"
          className="absolute inset-x-[2%] top-0 h-[80%] w-[96%] cursor-ew-resize appearance-none bg-transparent opacity-0 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--color-accent-primary)] [&::-webkit-slider-thumb]:h-full [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none"
        />
      </div>

      {/* Readout */}
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
        <span className="tabular-nums text-[var(--color-text-primary)]">
          <strong className="font-semibold">{tally.preserve}</strong> preserved ·{" "}
          <strong className="font-semibold">{tally.reconstruct}</strong> reconstructed
        </span>
        {counterfactual ? (
          <>
            <span className="text-[var(--color-text-secondary)]">
              {tally.flipped === 0
                ? "no region flips at this boundary"
                : `${tally.flipped} region${tally.flipped === 1 ? "" : "s"} would flip`}
            </span>
            <button
              type="button"
              onClick={() => onBoundaryChange(recordedBoundary)}
              className="rounded border border-[var(--color-border-default)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
            >
              reset to recorded {fmt(recordedBoundary)}
            </button>
            <span className="basis-full text-[11px] text-[var(--color-text-tertiary)]">
              Counterfactual: shows which decisions would flip. The groups a reconstruction would
              produce are not recomputed — that takes an engine run.
            </span>
          </>
        ) : (
          <span className="text-[var(--color-text-tertiary)]">
            drag the boundary to test the sensitivity of every decision
          </span>
        )}
      </div>
    </div>
  );
}
