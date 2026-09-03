"use client";

/**
 * Boundary strip — all regions on one score axis, with the quality boundary
 * as a draggable line.
 *
 * The decision rule is `score ≥ boundary → preserve`, and both the per-region
 * score and the boundary are recorded, so dragging the line and watching
 * regions flip is pure arithmetic over recorded values — no re-run (handoff
 * §9 idea 2). The strip states its honest limit: a counterfactual boundary
 * shows *which regions would flip*, not the hierarchy a re-run would produce.
 *
 * Two modes, because 502 marks is a distribution rather than a set of marks:
 * at or below the budget every region is drawn individually and is selectable;
 * above it, scores are binned and drawn as a stacked histogram in the same
 * three-state language. The mode in use is always stated.
 *
 * The slider is a real `<input type=range>` (keyboard- and screen-reader-
 * native) stretched invisibly across the axis; the visible line and handle
 * render from its value.
 *
 * Deterministic: marks stack within fixed score bins in canonical order.
 */

import * as React from "react";
import { tallyViews } from "./decision-model";
import { DecisionGlyph, DECISION_TOKEN } from "./decision-mark";
import { DecisionMarkShape } from "./decision-mark";
import { displayNumber } from "./format";
import type { DecisionState, RegionView } from "./types";

export interface BoundaryStripProps {
  regions: readonly RegionView[];
  boundary: number;
  recordedBoundary: number;
  onBoundaryChange: (boundary: number) => void;
  selectedId?: string | null;
  onSelect?: (regionId: string | null) => void;
  /** Individual marks drawn before the strip switches to a binned histogram. */
  budget?: number;
}

/** Above this many regions individual marks stop being readable. */
export const STRIP_BUDGET = 64;
/** Bin width in score units when binned. */
const BIN = 0.02;

const W = 960;
const H = 210;
const PAD_X = 22;
const AXIS_Y = 158;
const BAND_H = 124;
const R = 6.5;
const STATES: readonly DecisionState[] = ["preserve", "reconstruct", "degenerate"];

export function BoundaryStrip({
  regions,
  boundary,
  recordedBoundary,
  onBoundaryChange,
  selectedId,
  onSelect,
  budget = STRIP_BUDGET,
}: BoundaryStripProps) {
  const tally = tallyViews(regions);
  const counterfactual = Math.abs(boundary - recordedBoundary) > 1e-9;
  const binned = regions.length > budget;

  // --- Axis domain scaled to the data, boundary always in frame.
  const xMax = React.useMemo(() => {
    const maxScore = regions.reduce((m, r) => Math.max(m, r.score), 0);
    const needed = Math.max(maxScore, boundary, recordedBoundary) * 1.08;
    return Math.min(1, Math.max(0.2, Math.ceil(needed / 0.1) * 0.1));
  }, [regions, boundary, recordedBoundary]);
  const xOf = (score: number) => PAD_X + (score / xMax) * (W - 2 * PAD_X);

  // --- Discrete mode: deterministic upward stacking within a bin.
  const stacked = React.useMemo(() => {
    if (binned) return [];
    const seen = new Map<number, number>();
    return regions.map((region) => {
      const bin = Math.round(region.score / BIN);
      const level = seen.get(bin) ?? 0;
      seen.set(bin, level + 1);
      return { region, level };
    });
  }, [regions, binned]);

  // --- Binned mode: stacked counts per bin, per state.
  const histogram = React.useMemo(() => {
    if (!binned) return { bins: [], tallest: 0 };
    const map = new Map<number, Record<DecisionState, number>>();
    for (const region of regions) {
      const bin = Math.round(region.score / BIN);
      const cell = map.get(bin) ?? { preserve: 0, reconstruct: 0, degenerate: 0 };
      cell[region.state] += 1;
      map.set(bin, cell);
    }
    const bins = [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bin, counts]) => ({ bin, counts, total: counts.preserve + counts.reconstruct + counts.degenerate }));
    return { bins, tallest: bins.reduce((m, b) => Math.max(m, b.total), 0) };
  }, [regions, binned]);

  const toggle = (regionId: string) => onSelect?.(selectedId === regionId ? null : regionId);
  const bx = xOf(boundary);
  const binW = Math.max(3, ((W - 2 * PAD_X) * BIN) / xMax - 1);

  return (
    <div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full select-none"
          role="group"
          aria-label={`Boundary strip: ${regions.length} regions on the structural-quality score axis, boundary at ${displayNumber(boundary)}.`}
        >
          {/* Sides of the boundary, washed in the state each side produces */}
          <rect
            x={PAD_X}
            y={AXIS_Y - BAND_H}
            width={Math.max(0, bx - PAD_X)}
            height={BAND_H}
            fill={DECISION_TOKEN.reconstruct}
            opacity={0.05}
          />
          <rect
            x={bx}
            y={AXIS_Y - BAND_H}
            width={Math.max(0, W - PAD_X - bx)}
            height={BAND_H}
            fill={DECISION_TOKEN.preserve}
            opacity={0.05}
          />

          <line
            x1={PAD_X}
            y1={AXIS_Y}
            x2={W - PAD_X}
            y2={AXIS_Y}
            stroke="var(--color-border-active)"
            strokeWidth={1}
          />
          {Array.from({ length: 5 }, (_, i) => Number(((xMax / 4) * i).toFixed(4))).map((t) => (
            <g key={t}>
              <line x1={xOf(t)} y1={AXIS_Y} x2={xOf(t)} y2={AXIS_Y + 5} stroke="var(--color-border-active)" />
              <text
                x={xOf(t)}
                y={AXIS_Y + 18}
                textAnchor="middle"
                className="fill-[var(--color-text-tertiary)] font-mono text-[10px] tabular-nums"
              >
                {t}
              </text>
            </g>
          ))}
          <text
            x={W - PAD_X}
            y={AXIS_Y + 33}
            textAnchor="end"
            className="fill-[var(--color-text-tertiary)] text-[10px]"
          >
            structural-quality score → (axis to {xMax})
          </text>
          <text
            x={PAD_X}
            y={AXIS_Y - BAND_H - 6}
            className="text-[10px] font-medium"
            fill={DECISION_TOKEN.reconstruct}
          >
            reconstruct ←
          </text>
          <text
            x={W - PAD_X}
            y={AXIS_Y - BAND_H - 6}
            textAnchor="end"
            className="text-[10px] font-medium"
            fill={DECISION_TOKEN.preserve}
          >
            → preserve
          </text>

          {/* Recorded boundary tick, ghosted when a counterfactual is applied */}
          {counterfactual && (
            <g>
              <line
                x1={xOf(recordedBoundary)}
                y1={AXIS_Y - BAND_H}
                x2={xOf(recordedBoundary)}
                y2={AXIS_Y}
                stroke="var(--color-text-tertiary)"
                strokeDasharray="2 4"
              />
              <text
                x={xOf(recordedBoundary)}
                y={AXIS_Y - BAND_H - 18}
                textAnchor="middle"
                className="fill-[var(--color-text-tertiary)] font-mono text-[9px] tabular-nums"
              >
                recorded {displayNumber(recordedBoundary)}
              </text>
            </g>
          )}

          {/* Binned mode — a stacked distribution in the same colour language */}
          {binned &&
            histogram.bins.map(({ bin, counts, total }) => {
              const x = xOf(bin * BIN) - binW / 2;
              const scale = (BAND_H - 14) / Math.max(1, histogram.tallest);
              let y = AXIS_Y;
              return (
                <g key={bin}>
                  {STATES.map((state) => {
                    const h = counts[state] * scale;
                    if (h <= 0) return null;
                    y -= h;
                    return (
                      <rect
                        key={state}
                        x={x}
                        y={y}
                        width={binW}
                        height={h}
                        fill={DECISION_TOKEN[state]}
                        opacity={state === "degenerate" ? 0.45 : 0.85}
                      />
                    );
                  })}
                  <title>
                    {`score ${displayNumber(bin * BIN)}–${displayNumber((bin + 1) * BIN)}: ${total} region${total === 1 ? "" : "s"} — ${counts.preserve} preserved, ${counts.reconstruct} reconstructed, ${counts.degenerate} not assessed`}
                  </title>
                </g>
              );
            })}

          {/* Discrete mode — one selectable mark per region */}
          {!binned &&
            stacked.map(({ region, level }) => {
              const cx = xOf(region.score);
              const cy = AXIS_Y - 16 - level * 17;
              const selected = selectedId === region.regionId;
              const title = `${region.label} — score ${displayNumber(region.score)} · ${
                region.degenerate ? "not assessed (scored 0 by rule)" : region.effectiveAction
              }${region.flipped ? " · flips here" : ""}${
                region.userOverridden ? " · overridden, pinned" : ""
              }`;
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
                    r={R + 3.5}
                    fill="none"
                    stroke={
                      selected
                        ? "var(--color-decision-boundary)"
                        : region.flipped
                          ? "var(--color-text-secondary)"
                          : "transparent"
                    }
                    strokeWidth={selected ? 2 : 1}
                    strokeDasharray={selected ? undefined : region.flipped ? "2.5 2.5" : undefined}
                  />
                  <DecisionMarkShape state={region.state} cx={cx} cy={cy} size={R} />
                  {region.userOverridden && (
                    <text
                      x={cx}
                      y={cy - R - 5}
                      textAnchor="middle"
                      className="fill-[var(--color-text-tertiary)] text-[8px]"
                      aria-hidden="true"
                    >
                      pinned
                    </text>
                  )}
                  <title>{title}</title>
                </g>
              );
            })}

          {/* The boundary line + handle (visual layer of the range input) */}
          <g aria-hidden="true">
            <line
              x1={bx}
              y1={AXIS_Y - BAND_H}
              x2={bx}
              y2={AXIS_Y + 6}
              stroke="var(--color-decision-boundary)"
              strokeWidth={1.5}
              strokeDasharray="6 3"
            />
            <rect
              x={bx - 22}
              y={AXIS_Y + 8}
              width={44}
              height={17}
              rx={4}
              fill="var(--color-decision-boundary)"
            />
            <text
              x={bx}
              y={AXIS_Y + 20}
              textAnchor="middle"
              className="font-mono text-[10px] tabular-nums"
              fill="var(--color-text-on-accent)"
            >
              {displayNumber(boundary)}
            </text>
          </g>
        </svg>

        {/* The real control: an invisible full-width range over the axis band. */}
        <input
          type="range"
          min={0}
          max={xMax}
          step={0.001}
          value={boundary}
          onChange={(e) => onBoundaryChange(Number(e.target.value))}
          aria-label="Quality boundary — counterfactual only; regrouping is not recomputed"
          className="absolute inset-x-[2.2%] top-0 h-[72%] w-[95.6%] cursor-ew-resize appearance-none bg-transparent opacity-0 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--color-decision-boundary)] [&::-webkit-slider-thumb]:h-full [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none"
        />
      </div>

      {/* Three-way readout */}
      <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1.5 text-xs">
        {STATES.map((state) => {
          const n = state === "preserve" ? tally.preserve : state === "reconstruct" ? tally.reconstruct : tally.degenerate;
          const label =
            state === "preserve"
              ? "preserved"
              : state === "reconstruct"
                ? "reconstructed"
                : "not assessed";
          return (
            <span key={state} className="inline-flex items-center gap-1.5">
              <DecisionGlyph state={state} size={11} />
              <span className="tabular-nums font-semibold text-[var(--color-text-primary)]">{n}</span>
              <span style={{ color: DECISION_TOKEN[state] }}>{label}</span>
            </span>
          );
        })}

        {counterfactual ? (
          <>
            <span className="text-[var(--color-text-secondary)]">
              {tally.flipped === 0
                ? "no measured region flips here"
                : `${tally.flipped} measured region${tally.flipped === 1 ? "" : "s"} would flip`}
            </span>
            <button
              type="button"
              onClick={() => onBoundaryChange(recordedBoundary)}
              className="rounded border border-[var(--color-border-default)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] focus-visible:outline-2 focus-visible:outline-[var(--color-decision-boundary)]"
            >
              reset to recorded {displayNumber(recordedBoundary)}
            </button>
          </>
        ) : (
          <span className="text-[var(--color-text-tertiary)]">
            drag the boundary to test the sensitivity of every measured decision
          </span>
        )}

        <p className="basis-full text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
          {binned
            ? `Binned distribution: ${regions.length} regions in ${displayNumber(BIN)}-wide score bins (above the ${budget}-mark budget for individual marks). `
            : ""}
          {counterfactual
            ? "Counterfactual: shows which measured decisions would flip. The groups a reconstruction would produce are not recomputed — that takes an engine run. "
            : ""}
          {tally.degenerate > 0 &&
            `${tally.degenerate} region${tally.degenerate === 1 ? "" : "s"} scored 0 by rule rather than by measurement and cannot flip at any boundary.`}
        </p>
      </div>
    </div>
  );
}
