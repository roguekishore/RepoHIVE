"use client";

/**
 * Region morph — the same file set drawn twice: once inside the boundary the
 * author wrote (the package), once inside the groups the engine derived from
 * the dependencies. Scrubbing between the two states is the one animation
 * that explains the whole project without words (handoff §9 idea 1, §10).
 *
 * Data honesty: files, cells and edges all come from the index — group
 * membership from the recorded region→group provenance, edges from the
 * recorded leaf edges lifted to files. The morph invents nothing; it only
 * *arranges*. Edges are tinted by whether their endpoints share a derived
 * cell, so in the authored state the viewer sees the clusters tangled inside
 * one box, and as the morph runs they physically separate — the few edges
 * that stay cross-cluster are exactly the coupling the engine measured.
 *
 * Deterministic layout: a pure function of the (canonically ordered) props.
 * The tween is presentation-only, driven by user interaction, and collapses
 * to a hard cut under prefers-reduced-motion.
 */

import * as React from "react";
import type { DecisionAction } from "./types";

export interface MorphFile {
  id: string;
  name: string;
  packagePath: string;
}

export interface MorphCell {
  id: string;
  label: string;
  fileIds: string[];
}

export interface MorphEdge {
  source: string;
  target: string;
  strength: number;
}

export interface RegionMorphProps {
  regionLabel: string;
  action: DecisionAction;
  files: readonly MorphFile[];
  authored: readonly MorphCell[];
  derived: readonly MorphCell[];
  edges: readonly MorphEdge[];
  /** Files dropped by the adapter's deterministic size cap (0 = none). */
  truncatedFiles?: number;
}

/* ---------------------------------------------------------------- layout */

const TILE = 26;
const GAP = 8;
const CELL_PAD = 14;
const LABEL_BAND = 24;
const ROW_GAP = 26;
const CELL_GAP = 22;
const MAX_ROW_W = 920;

interface CellBox {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PartitionLayout {
  width: number;
  height: number;
  cells: CellBox[];
  tiles: Map<string, { x: number; y: number }>;
}

/** Pure, deterministic: grid files inside each cell, row-pack cells, centre rows. */
function layoutPartition(cells: readonly MorphCell[]): PartitionLayout {
  const sized = cells.map((cell) => {
    const n = Math.max(1, cell.fileIds.length);
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)));
    const rows = Math.ceil(n / cols);
    return {
      cell,
      cols,
      w: CELL_PAD * 2 + cols * TILE + (cols - 1) * GAP,
      h: LABEL_BAND + CELL_PAD * 2 + rows * TILE + (rows - 1) * GAP,
    };
  });

  // Greedy row packing in given (canonical) order.
  const rows: Array<Array<(typeof sized)[number]>> = [];
  let current: Array<(typeof sized)[number]> = [];
  let currentW = 0;
  for (const s of sized) {
    const nextW = currentW === 0 ? s.w : currentW + CELL_GAP + s.w;
    if (current.length > 0 && nextW > MAX_ROW_W) {
      rows.push(current);
      current = [s];
      currentW = s.w;
    } else {
      current.push(s);
      currentW = nextW;
    }
  }
  if (current.length > 0) rows.push(current);

  const width = Math.max(
    1,
    ...rows.map((row) => row.reduce((sum, s) => sum + s.w, 0) + (row.length - 1) * CELL_GAP),
  );

  const cellBoxes: CellBox[] = [];
  const tiles = new Map<string, { x: number; y: number }>();
  let y = 0;
  for (const row of rows) {
    const rowW = row.reduce((sum, s) => sum + s.w, 0) + (row.length - 1) * CELL_GAP;
    const rowH = Math.max(...row.map((s) => s.h));
    let x = (width - rowW) / 2;
    for (const s of row) {
      cellBoxes.push({ id: s.cell.id, label: s.cell.label, x, y, w: s.w, h: s.h });
      s.cell.fileIds.forEach((fileId, i) => {
        const col = i % s.cols;
        const r = Math.floor(i / s.cols);
        tiles.set(fileId, {
          x: x + CELL_PAD + col * (TILE + GAP),
          y: y + LABEL_BAND + CELL_PAD + r * (TILE + GAP),
        });
      });
      x += s.w + CELL_GAP;
    }
    y += rowH + ROW_GAP;
  }

  return { width, height: Math.max(1, y - ROW_GAP), cells: cellBoxes, tiles };
}

/* ---------------------------------------------------------------- tween */

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ------------------------------------------------------------- component */

export function RegionMorph({
  regionLabel,
  action,
  files,
  authored,
  derived,
  edges,
  truncatedFiles = 0,
}: RegionMorphProps) {
  const layoutA = React.useMemo(() => layoutPartition(authored), [authored]);
  const layoutB = React.useMemo(() => layoutPartition(derived), [derived]);

  // Which derived cell holds each file — colours cells and tints edges.
  const derivedCellOf = React.useMemo(() => {
    const map = new Map<string, number>();
    derived.forEach((cell, index) => {
      for (const fileId of cell.fileIds) map.set(fileId, index);
    });
    return map;
  }, [derived]);

  const [t, setT] = React.useState(1); // land on the derived state
  const animRef = React.useRef<number | null>(null);
  // Latest t, so animation starts read the live value without re-creating
  // the callback per frame.
  const tRef = React.useRef(t);
  tRef.current = t;

  const animateTo = React.useCallback((target: number) => {
    if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setT(target);
      return;
    }
    let start: number | null = null;
    let from = 0;
    const DURATION = 950;
    const step = (now: number) => {
      if (start === null) {
        start = now;
        from = tRef.current;
      }
      const p = Math.min(1, (now - start) / DURATION);
      setT(from + (target - from) * easeInOutCubic(p));
      if (p < 1) animRef.current = requestAnimationFrame(step);
      else animRef.current = null;
    };
    animRef.current = requestAnimationFrame(step);
  }, []);

  React.useEffect(() => {
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, []);

  const width = Math.max(layoutA.width, layoutB.width);
  const height = Math.max(layoutA.height, layoutB.height);
  // Centre the narrower layout inside the shared canvas.
  const dxA = (width - layoutA.width) / 2;
  const dxB = (width - layoutB.width) / 2;

  const maxStrength = edges.reduce((m, e) => Math.max(m, e.strength), 0) || 1;

  const posOf = (fileId: string): { x: number; y: number } | null => {
    const a = layoutA.tiles.get(fileId);
    const b = layoutB.tiles.get(fileId);
    if (!a || !b) return null;
    return {
      x: lerp(a.x + dxA, b.x + dxB, t) + TILE / 2,
      y: lerp(a.y, b.y, t) + TILE / 2,
    };
  };

  const authoredSide = action === "preserve";
  const derivedNoun = authoredSide ? "size-bounded slices" : "dependency clusters";

  return (
    <figure className="m-0">
      {/* Controls */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Morph state"
          className="inline-flex overflow-hidden rounded-md border border-[var(--color-border-default)]"
        >
          <button
            type="button"
            aria-pressed={t < 0.5}
            onClick={() => animateTo(0)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              t < 0.5
                ? "bg-[var(--color-text-primary)] text-[var(--color-bg-surface)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
            }`}
          >
            As authored
          </button>
          <button
            type="button"
            aria-pressed={t >= 0.5}
            onClick={() => animateTo(1)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              t >= 0.5
                ? "bg-[var(--color-text-primary)] text-[var(--color-bg-surface)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
            }`}
          >
            As derived
          </button>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={t}
          onChange={(e) => {
            if (animRef.current !== null) cancelAnimationFrame(animRef.current);
            animRef.current = null;
            setT(Number(e.target.value));
          }}
          aria-label="Scrub between the authored and derived arrangements"
          className="h-1.5 w-40 cursor-ew-resize accent-[var(--color-accent-primary)]"
        />
        {truncatedFiles > 0 && (
          <span className="text-[11px] text-[var(--color-text-tertiary)]">
            {truncatedFiles} least-connected file{truncatedFiles === 1 ? "" : "s"} not drawn
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-inset)] p-4">
        <svg
          viewBox={`-8 -8 ${width + 16} ${height + 16}`}
          className="mx-auto block"
          style={{ width: Math.min(width + 16, 1100), minWidth: 320 }}
          role="img"
          aria-label={`${regionLabel}: ${files.length} files arranged by the authored package on one side and by the ${derived.length} derived ${derivedNoun} on the other.`}
        >
          {/* Authored hulls (fade out as t → 1) */}
          <g opacity={1 - t} aria-hidden={t >= 0.999}>
            {layoutA.cells.map((cell) => (
              <g key={`a-${cell.id}`}>
                <rect
                  x={cell.x + dxA}
                  y={cell.y}
                  width={cell.w}
                  height={cell.h}
                  rx={10}
                  fill="var(--color-bg-elevated)"
                  stroke="var(--color-border-active)"
                  strokeWidth={1.25}
                />
                <text
                  x={cell.x + dxA + CELL_PAD}
                  y={cell.y + 16}
                  className="fill-[var(--color-text-secondary)] font-mono text-[11px]"
                >
                  {cell.label}
                </text>
              </g>
            ))}
          </g>

          {/* Derived hulls (fade in) */}
          <g opacity={t} aria-hidden={t <= 0.001}>
            {layoutB.cells.map((cell, index) => (
              <g key={`b-${cell.id}`}>
                <rect
                  x={cell.x + dxB}
                  y={cell.y}
                  width={cell.w}
                  height={cell.h}
                  rx={10}
                  fill={`var(--color-community-${(index % 12) + 1}-soft)`}
                  stroke={`var(--color-community-${(index % 12) + 1})`}
                  strokeWidth={1.25}
                  strokeDasharray={authoredSide ? undefined : "5 3"}
                />
                <text
                  x={cell.x + dxB + CELL_PAD}
                  y={cell.y + 16}
                  className="fill-[var(--color-text-secondary)] font-mono text-[11px]"
                >
                  {cell.label}
                </text>
              </g>
            ))}
          </g>

          {/* Edges under the tiles. A dependency whose endpoints land in the
              same derived cell was *captured* by the new boundary — drawn in
              the reconstruct hue, because it is the evidence for the rebuild.
              One that still crosses cells is *residual* coupling the
              clustering could not remove: neutral and dashed, so it reads as
              remaining work rather than as a fault. Amber is not used here;
              it belongs to the quality boundary alone. */}
          <g>
            {edges.map((edge) => {
              const a = posOf(edge.source);
              const b = posOf(edge.target);
              if (!a || !b) return null;
              const cross = derivedCellOf.get(edge.source) !== derivedCellOf.get(edge.target);
              return (
                <line
                  key={`${edge.source} -> ${edge.target}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={
                    cross ? "var(--color-text-secondary)" : "var(--color-decision-reconstruct)"
                  }
                  strokeWidth={1 + (edge.strength / maxStrength) * 1.75}
                  strokeDasharray={cross ? "4 3" : undefined}
                  opacity={cross ? 0.75 : 0.45}
                />
              );
            })}
          </g>

          {/* File tiles */}
          <g>
            {files.map((file) => {
              const p = posOf(file.id);
              if (!p) return null;
              return (
                <g key={file.id}>
                  <rect
                    x={p.x - TILE / 2}
                    y={p.y - TILE / 2}
                    width={TILE}
                    height={TILE}
                    rx={6}
                    fill="var(--color-zoom-card-fill)"
                    stroke="var(--color-zoom-card-border)"
                    strokeWidth={1}
                  />
                  <text
                    x={p.x}
                    y={p.y + 3.5}
                    textAnchor="middle"
                    className="pointer-events-none fill-[var(--color-zoom-card-text)] font-mono text-[10px]"
                    aria-hidden
                  >
                    {file.name.slice(0, 2)}
                  </text>
                  <title>
                    {file.name} · {file.packagePath || "(no package)"}
                  </title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <figcaption className="mt-2 text-[12px] leading-relaxed text-[var(--color-text-tertiary)]">
        {authoredSide ? (
          <>
            This region met the quality boundary, so its authored boundary was{" "}
            <span className="text-[var(--color-success)]">preserved</span> — the derived side shows
            only the size bound splitting it into {derived.length} slice
            {derived.length === 1 ? "" : "s"}, not a re-clustering.
          </>
        ) : (
          <>
            The author shipped these {files.length} files as one package; the dependencies separate
            them into {derived.length} cluster{derived.length === 1 ? "" : "s"}. Solid blue edges are
            couplings the new boundary <em>captured</em>; dashed grey ones are residual coupling that
            still crosses clusters.
          </>
        )}
      </figcaption>
    </figure>
  );
}
