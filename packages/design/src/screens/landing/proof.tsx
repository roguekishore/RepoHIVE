"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { rgbaCss } from "../../canvas/colors";
import { useCanvasPalette } from "../../canvas/use-canvas-palette";
import type { LandingFigures, RegionRow } from "./figures-types";
import { usePrefersReducedMotion } from "./use-reduced-motion";

const number = new Intl.NumberFormat("en-US");

/** The repository in six figures. Each one is a count the index recorded. */
export function ProofFigures({ figures }: { readonly figures: LandingFigures }) {
  const { counts } = figures;
  const items: readonly { readonly value: number; readonly label: string; readonly role?: "k" | "r" }[] = [
    { value: counts.files, label: "Java files" },
    { value: counts.nodes, label: "nodes in the hierarchy" },
    { value: counts.regions, label: "packages, as regions" },
    { value: counts.assessed, label: "large enough to measure" },
    { value: counts.preserved, label: "kept as written", role: "k" },
    { value: counts.reconstructed, label: "rebuilt from dependencies", role: "r" },
  ];
  return (
    <div className="rh-ld-figs">
      {items.map((item) => (
        <div key={item.label} className={item.role === undefined ? undefined : `rh-ld-${item.role}`}>
          <b>{number.format(item.value)}</b>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/** One cell of the waffle: a measured region, or `null` for one too small to measure. */
type Cell = RegionRow | null;

interface Layout {
  readonly cols: number;
  readonly cell: number;
  readonly gap: number;
  readonly w: number;
  readonly h: number;
}

const EMPTY: Layout = { cols: 1, cell: 18, gap: 4, w: 0, h: 0 };
const ENTRANCE_MS = 700;
const STEP_MS = 14;

/** Kept regions by score, then rebuilt ones by score, then one cell for each region too small to measure. */
export function waffleOrder(regions: readonly RegionRow[], degenerate: number): Cell[] {
  const byScore = (a: RegionRow, b: RegionRow): number => b[4] - a[4] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const cells: Cell[] = [...regions.filter((row) => row[5] === 1).sort(byScore), ...regions.filter((row) => row[5] === 2).sort(byScore)];
  for (let index = 0; index < degenerate; index += 1) cells.push(null);
  return cells;
}

/** The layout for a canvas `w` pixels wide: a target cell size, as many columns as fit, and the cell stretched to fill. */
export function waffleLayout(w: number, count: number): Layout {
  const gap = w < 600 ? 3 : 4;
  const target = w < 600 ? 14 : 17;
  const cols = Math.max(8, Math.floor((w + gap) / (target + gap)));
  const cell = (w - gap * (cols - 1)) / cols;
  const rows = Math.ceil(count / cols);
  return { cols, cell, gap, w, h: rows * cell + Math.max(0, rows - 1) * gap };
}

/**
 * One square per region on a canvas: kept regions are filled squares, rebuilt ones filled circles, and the ones too small
 * to measure outlined squares, so the three differ by shape as well as by colour. Hovering a cell says what it is.
 */
export function RegionWaffle({ figures }: { readonly figures: LandingFigures }) {
  const { counts, regions } = figures;
  const cells = useMemo(() => waffleOrder(regions, counts.degenerate), [regions, counts.degenerate]);
  const reduced = usePrefersReducedMotion();
  const palette = useCanvasPalette();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layout = useRef<Layout>(EMPTY);
  const hover = useRef(-1);
  const started = useRef<number | null>(null);
  const frame = useRef(0);
  const [tip, setTip] = useState<{ readonly index: number; readonly left: number; readonly top: number } | undefined>();

  const draw = useCallback(
    (now?: number): void => {
      const el = canvas.current;
      const ctx = el?.getContext("2d");
      if (el === null || el === undefined || ctx === null || ctx === undefined || palette === undefined) return;
      const { cols, cell, gap, w, h } = layout.current;
      const kept = rgbaCss(palette.colors.fg, 1);
      const rebuilt = rgbaCss(palette.colors.accent, 1);
      const small = rgbaCss(palette.colors["line-strong"], 1);
      ctx.clearRect(0, 0, w, h);
      cells.forEach((row, index) => {
        const column = index % cols;
        const line = Math.floor(index / cols);
        const x = column * (cell + gap);
        const y = line * (cell + gap);
        let scale = 1;
        if (started.current !== null && now !== undefined) {
          const e = (now - started.current - (column + line) * STEP_MS) / ENTRANCE_MS;
          scale = e <= 0 ? 0.3 : e >= 1 ? 1 : 0.3 + 0.7 * (1 - Math.pow(2, -10 * e));
        }
        const size = cell * scale;
        const offset = (cell - size) / 2;
        if (row !== null && row[5] === 1) {
          ctx.fillStyle = kept;
          ctx.fillRect(x + offset, y + offset, size, size);
        } else if (row !== null) {
          ctx.fillStyle = rebuilt;
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = small;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x + offset + 0.75, y + offset + 0.75, size - 1.5, size - 1.5);
        }
        if (index === hover.current) {
          ctx.strokeStyle = kept;
          ctx.lineWidth = 2;
          ctx.strokeRect(x - 2, y - 2, cell + 4, cell + 4);
        }
      });
    },
    [cells, palette],
  );

  const place = useCallback(
    (width: number): void => {
      const el = canvas.current;
      if (el === null || width <= 0) return;
      layout.current = waffleLayout(width, cells.length);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.style.height = `${layout.current.h}px`;
      el.width = Math.round(width * dpr);
      el.height = Math.round(layout.current.h * dpr);
      el.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    },
    [cells.length, draw],
  );

  useEffect(() => {
    const element = wrap.current;
    if (element === null) return undefined;
    place(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (Math.abs(element.clientWidth - layout.current.w) > 1) place(element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [place]);

  // The entrance plays once, when the waffle first scrolls into view (never with reduced motion).
  useEffect(() => {
    const element = wrap.current;
    if (reduced || element === null || typeof IntersectionObserver === "undefined") return undefined;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watcher.disconnect();
        const begin = performance.now();
        started.current = begin;
        const total = ENTRANCE_MS + (layout.current.cols + Math.ceil(cells.length / layout.current.cols)) * STEP_MS;
        const run = (now: number): void => {
          draw(now);
          if (now - begin < total) frame.current = requestAnimationFrame(run);
          else {
            started.current = null;
            draw();
          }
        };
        frame.current = requestAnimationFrame(run);
      },
      { threshold: 0.4 },
    );
    watcher.observe(element);
    return () => {
      watcher.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [reduced, cells.length, draw]);

  const point = (event: PointerEvent<HTMLCanvasElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const { cols, cell, gap, w } = layout.current;
    const step = cell + gap;
    const column = Math.floor(x / step);
    const line = Math.floor(y / step);
    let index = line * cols + column;
    if (column < 0 || column >= cols || x - column * step > cell || y - line * step > cell || index >= cells.length) index = -1;
    if (index !== hover.current) {
      hover.current = index;
      draw();
    }
    setTip(index < 0 ? undefined : { index, left: Math.min(Math.max(column * step + cell / 2, 100), Math.max(100, w - 100)), top: line * step });
  };

  const leave = (): void => {
    hover.current = -1;
    setTip(undefined);
    draw();
  };

  const current = tip === undefined ? undefined : cells[tip.index];
  return (
    <div className="rh-ld-waffle-box">
      <div ref={wrap} className="rh-ld-waffle-wrap">
        <canvas
          ref={canvas}
          onPointerMove={point}
          onPointerLeave={leave}
          role="img"
          aria-label={`${cells.length} squares, one per region of ${figures.repository}: ${counts.preserved} kept, ${counts.reconstructed} rebuilt, ${counts.degenerate} too small to measure`}
        />
        <div className="rh-ld-tip" hidden={tip === undefined} style={tip === undefined ? undefined : { left: tip.left, top: tip.top }} role="status">
          {tip === undefined ? null : current === null || current === undefined ? (
            <>
              <b>Too small to measure</b>
              <span>Fewer than two files, or no dependencies inside</span>
            </>
          ) : (
            <>
              <b>{current[0]}</b>
              <span>
                {number.format(current[1])} files · score {current[4].toFixed(3)} · {current[5] === 1 ? "kept" : "rebuilt"}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="rh-ld-waffle-foot">
        <div className="rh-ld-legend">
          <span>
            <i className="rh-ld-key-k" />
            Kept as written
          </span>
          <span>
            <i className="rh-ld-key-r" />
            Rebuilt from dependencies
          </span>
          <span>
            <i className="rh-ld-key-u" />
            Too small to measure
          </span>
        </div>
        <span className="rh-fg3">One square per region. Hover one for its score.</span>
      </div>
    </div>
  );
}
