"use client";

/**
 * Hierarchy sunburst — the whole containment tree in one image, coloured by
 * the recorded decision state.
 *
 * A radial icicle rather than a treemap: depth is the radius, so the reader
 * sees the level structure the engine built (repository → groups → files) at a
 * glance, and each arc's sweep is proportional to the file count beneath it.
 * The point is scale handled legibly — 30,889 nodes, depth 6 — so the ring key
 * comes from the recorded `perLevel[]` rather than from anything derived.
 *
 * Layout arrives pre-computed and canonically ordered from the adapter, so this
 * component is deterministic by construction: identical input, identical
 * picture, which is what makes it usable as a paper figure.
 */

import * as React from "react";
import { DECISION_TOKEN } from "./decision-mark";
import { middleElide } from "./format";
import type { DecisionState } from "./types";

export type ArcState = DecisionState | "none";

export interface SunburstArc {
  id: string;
  level: number;
  start: number;
  span: number;
  files: number;
  state: ArcState;
  label: string;
  regionId: string | null;
  /** A group belonging to no region — a structural fan-out wrapper. */
  wrapper?: boolean;
}

export interface HierarchySunburstProps {
  arcs: readonly SunburstArc[];
  maxLevel: number;
  totalFiles: number;
  totalNodes: number;
  omittedArcs?: number;
  levels?: ReadonlyArray<{ level: number; groupNodeCount: number; leafNodeCount: number }>;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  size?: number;
}

/** An arc with no recorded decision reads as structure, not as an outcome. */
const ARC_FILL: Record<ArcState, string> = {
  preserve: DECISION_TOKEN.preserve,
  reconstruct: DECISION_TOKEN.reconstruct,
  degenerate: DECISION_TOKEN.degenerate,
  none: "var(--color-text-tertiary)",
};

const TAU = Math.PI * 2;

/** SVG path for an annular sector. Angles in turns, clockwise from 12 o'clock. */
function arcPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  start: number,
  span: number,
): string {
  // A full ring cannot be drawn as one arc (start === end), so split it.
  if (span >= 0.9999) {
    const half = 0.5;
    return `${arcPath(cx, cy, rInner, rOuter, 0, half)} ${arcPath(cx, cy, rInner, rOuter, half, half)}`;
  }
  const a0 = start * TAU - Math.PI / 2;
  const a1 = (start + span) * TAU - Math.PI / 2;
  const large = span > 0.5 ? 1 : 0;
  const x0o = cx + rOuter * Math.cos(a0);
  const y0o = cy + rOuter * Math.sin(a0);
  const x1o = cx + rOuter * Math.cos(a1);
  const y1o = cy + rOuter * Math.sin(a1);
  const x1i = cx + rInner * Math.cos(a1);
  const y1i = cy + rInner * Math.sin(a1);
  const x0i = cx + rInner * Math.cos(a0);
  const y0i = cy + rInner * Math.sin(a0);
  return [
    `M ${x0o.toFixed(2)} ${y0o.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1o.toFixed(2)} ${y1o.toFixed(2)}`,
    `L ${x1i.toFixed(2)} ${y1i.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x0i.toFixed(2)} ${y0i.toFixed(2)}`,
    "Z",
  ].join(" ");
}

export function HierarchySunburst({
  arcs,
  maxLevel,
  totalFiles,
  totalNodes,
  omittedArcs = 0,
  levels = [],
  selectedId,
  onSelect,
  size = 640,
}: HierarchySunburstProps) {
  const cx = size / 2;
  const cy = size / 2;
  const hub = Math.max(26, size * 0.055);
  const outer = size / 2 - 8;
  const ringDepth = maxLevel > 0 ? (outer - hub) / maxLevel : outer - hub;

  const radii = (level: number) => ({
    inner: hub + (level - 1) * ringDepth,
    outer: hub + level * ringDepth,
  });

  const toggle = (id: string) => onSelect?.(selectedId === id ? null : id);

  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="mx-auto block"
          style={{ width: "100%", maxWidth: size }}
          role="img"
          aria-label={`Containment hierarchy: ${totalNodes.toLocaleString()} nodes over ${maxLevel} levels, ${arcs.length.toLocaleString()} arcs drawn, coloured by recorded decision state.`}
        >
          {/* Ring guides, one per level */}
          {Array.from({ length: maxLevel }, (_, i) => i + 1).map((level) => (
            <circle
              key={`ring-${level}`}
              cx={cx}
              cy={cy}
              r={radii(level).outer}
              fill="none"
              stroke="var(--color-border-default)"
              strokeWidth={0.5}
            />
          ))}

          {arcs.map((arc) => {
            const { inner, outer: ro } = radii(arc.level);
            const selected = selectedId === arc.id;
            const title = `${arc.regionId ?? arc.id} — level ${arc.level} · ${arc.files.toLocaleString()} file${arc.files === 1 ? "" : "s"} · ${
              arc.state === "none"
                ? arc.wrapper
                  ? "structural wrapper, belongs to no region"
                  : "no recorded decision"
                : arc.state
            }`;
            return (
              <path
                key={arc.id}
                d={arcPath(cx, cy, inner, ro, arc.start, arc.span)}
                fill={ARC_FILL[arc.state]}
                fillOpacity={arc.state === "none" ? 0.22 : selected ? 0.95 : 0.62}
                stroke={selected ? "var(--color-decision-boundary)" : "var(--color-bg-root)"}
                strokeWidth={selected ? 2 : 0.5}
                className="cursor-pointer outline-none"
                role="button"
                tabIndex={arc.span > 0.01 ? 0 : -1}
                aria-label={title}
                onClick={() => toggle(arc.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(arc.id);
                  }
                }}
              >
                <title>{title}</title>
              </path>
            );
          })}

          {/* Hub: the repository, and the number the picture is about */}
          <circle cx={cx} cy={cy} r={hub} fill="var(--color-bg-surface)" stroke="var(--color-border-active)" />
          <text
            x={cx}
            y={cy - 2}
            textAnchor="middle"
            className="fill-[var(--color-text-primary)] text-[15px] font-semibold tabular-nums"
          >
            {totalFiles.toLocaleString()}
          </text>
          <text
            x={cx}
            y={cy + 12}
            textAnchor="middle"
            className="fill-[var(--color-text-tertiary)] text-[9px] uppercase tracking-[0.1em]"
          >
            files
          </text>

          {/* Labels for arcs wide enough to carry one */}
          {arcs
            .filter((arc) => arc.label.length > 0)
            .map((arc) => {
              const { inner, outer: ro } = radii(arc.level);
              const mid = (arc.start + arc.span / 2) * TAU - Math.PI / 2;
              const r = (inner + ro) / 2;
              const x = cx + r * Math.cos(mid);
              const y = cy + r * Math.sin(mid);
              const deg = (mid * 180) / Math.PI;
              const flip = deg > 90 || deg < -90;
              return (
                <text
                  key={`label-${arc.id}`}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${flip ? deg + 180 : deg} ${x} ${y})`}
                  className="pointer-events-none fill-[var(--color-text-primary)] font-mono text-[9px]"
                >
                  {middleElide(arc.label, 14)}
                </text>
              );
            })}
        </svg>
      </div>

      <figcaption className="mt-2 space-y-1.5">
        {levels.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
            {levels
              .filter((row) => row.groupNodeCount > 0 || row.leafNodeCount > 0)
              .map((row) => (
                <li key={row.level} className="tabular-nums">
                  <span className="text-[var(--color-text-secondary)]">L{row.level}</span>{" "}
                  {row.groupNodeCount > 0
                    ? `${row.groupNodeCount.toLocaleString()} groups`
                    : `${row.leafNodeCount.toLocaleString()} leaves`}
                </li>
              ))}
          </ul>
        )}
        <p className="text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
          Radius is depth; each arc&rsquo;s sweep is the file count beneath it. Grey arcs are
          structural wrappers the engine created to bound fan-out — they belong to no region, so they
          carry no decision.
          {omittedArcs > 0 && (
            <>
              {" "}
              <strong className="font-medium text-[var(--color-text-secondary)]">
                {omittedArcs.toLocaleString()} arcs below the visibility floor are not drawn
              </strong>{" "}
              (a sweep under ~0.3°, which cannot be seen or clicked).
            </>
          )}
        </p>
      </figcaption>
    </figure>
  );
}
