/**
 * Deterministic layouts for canvases. Each is a pure function of its input and a seed: no clock, no
 * `Math.random`, and every tie is broken by the seeded hash of the item's key, never by input order or object
 * identity. Identical input gives identical numbers on every machine.
 */
import type { Point, Rect } from "./camera";
import { createRng, hashSeed } from "./seeded";

const compareKeys = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface WeightedItem {
  readonly key: string;
  /** The area this item should get, relative to the others. Zero or negative is treated as a sliver. */
  readonly weight: number;
}

export interface Placed {
  readonly key: string;
  readonly rect: Rect;
}

const SLIVER = 1e-9;

/**
 * A squarified treemap: the items tile `rect` exactly, each with an area proportional to its weight, and rectangles as
 * close to square as the algorithm manages. Items are placed largest first; equal weights are ordered by the seeded
 * hash of their key, so the arrangement is stable and does not follow the order the caller listed them in.
 */
export function squarify(items: readonly WeightedItem[], rect: Rect, seed: number | string = 0): Placed[] {
  if (items.length === 0 || rect.w <= 0 || rect.h <= 0) return [];
  const sorted = items
    .map((item) => ({ key: item.key, weight: Math.max(item.weight, SLIVER) }))
    .sort(
      (a, b) => b.weight - a.weight || hashSeed(seed, a.key) - hashSeed(seed, b.key) || compareKeys(a.key, b.key),
    );
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  const unit = (rect.w * rect.h) / total;
  const areas = sorted.map((item) => item.weight * unit);

  const placed: Placed[] = [];
  let free: Rect = { ...rect };
  let start = 0;

  const worst = (from: number, to: number, side: number): number => {
    let sum = 0;
    let max = 0;
    let min = Infinity;
    for (let i = from; i < to; i++) {
      const area = areas[i] ?? 0;
      sum += area;
      max = Math.max(max, area);
      min = Math.min(min, area);
    }
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  const lay = (from: number, to: number): void => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += areas[i] ?? 0;
    if (free.w >= free.h) {
      // A column on the left edge, stacked top to bottom.
      const width = sum / free.h;
      let y = free.y;
      for (let i = from; i < to; i++) {
        const h = (areas[i] ?? 0) / width;
        placed.push({ key: sorted[i]?.key ?? "", rect: { x: free.x, y, w: width, h } });
        y += h;
      }
      free = { x: free.x + width, y: free.y, w: free.w - width, h: free.h };
    } else {
      // A row along the top edge, left to right.
      const height = sum / free.w;
      let x = free.x;
      for (let i = from; i < to; i++) {
        const w = (areas[i] ?? 0) / height;
        placed.push({ key: sorted[i]?.key ?? "", rect: { x, y: free.y, w, h: height } });
        x += w;
      }
      free = { x: free.x, y: free.y + height, w: free.w, h: free.h - height };
    }
  };

  let end = 1;
  while (end <= sorted.length) {
    const side = Math.min(free.w, free.h);
    const grows = end === start + 1 || worst(start, end, side) <= worst(start, end - 1, side);
    if (grows && end < sorted.length) {
      end++;
    } else if (grows) {
      lay(start, end);
      break;
    } else {
      lay(start, end - 1);
      start = end - 1;
    }
  }
  return placed;
}

export interface PackChild {
  readonly key: string;
  /** Placement order, most important first. */
  readonly rank: number;
  /** How central the card is; larger importance, larger card. */
  readonly importance: number;
}

export interface PackOptions {
  /** Whitespace between cards, in card-height units. */
  readonly gutter?: number;
  /** Card height for the least and the most important sibling. */
  readonly sizeMin?: number;
  readonly sizeMax?: number;
  /** Below 1 lifts small cards so minor ones stay readable. */
  readonly gamma?: number;
  /** Card width to height. */
  readonly aspect?: number;
}

const PACK_DEFAULTS = { gutter: 0.3, sizeMin: 0.58, sizeMax: 1, gamma: 0.7, aspect: 1.5 } as const;

/**
 * A masonry pack: cards sized by importance, row-packed with a gutter into centred rows, then fitted (aspect kept)
 * into the unit square. Unlike a treemap it leaves space between cards, which is where relation lines are drawn.
 * `parentAspect` is the width to height of the box the result is stretched onto, so cards keep one shape at any depth.
 * Order is by rank, then key; there is no randomness.
 */
export function packCards(children: readonly PackChild[], parentAspect: number, options: PackOptions = {}): Map<string, Rect> {
  const { gutter, sizeMin, sizeMax, gamma, aspect: base } = { ...PACK_DEFAULTS, ...options };
  const out = new Map<string, Rect>();
  if (children.length === 0) return out;
  const aspect = Math.min(8, Math.max(0.2, base / (parentAspect || 1)));
  const ordered = [...children].sort((a, b) => a.rank - b.rank || compareKeys(a.key, b.key));
  const value = (c: PackChild): number => (Number.isFinite(c.importance) ? c.importance : 0);
  const lo = Math.min(...ordered.map(value));
  const span = Math.max(...ordered.map(value)) - lo;
  const cards = ordered.map((c) => {
    const norm = span > 1e-9 ? (value(c) - lo) / span : 1;
    const h = sizeMin + (sizeMax - sizeMin) * Math.pow(norm, gamma);
    return { key: c.key, w: h * aspect, h };
  });

  // Aim for the column count whose shape follows the parent, so the cluster fits with little slack.
  const wanted = Math.min(6, Math.max(1 / 6, parentAspect || 1));
  const count = cards.length;
  const rowsGuess = Math.ceil(count / Math.min(count, Math.max(1, Math.round(Math.sqrt(count * wanted)))));
  const cols = count === 1 ? 1 : Math.ceil(count / rowsGuess);
  const avgW = cards.reduce((sum, c) => sum + c.w, 0) / count;
  const target = cols * avgW + Math.max(0, cols - 1) * gutter;

  type Card = (typeof cards)[number];
  const rows: Card[][] = [];
  let row: Card[] = [];
  let rowWidth = 0;
  for (const card of cards) {
    const add = (row.length > 0 ? gutter : 0) + card.w;
    if (row.length > 0 && rowWidth + add > target) {
      rows.push(row);
      row = [];
      rowWidth = 0;
    }
    rowWidth += (row.length > 0 ? gutter : 0) + card.w;
    row.push(card);
  }
  if (row.length > 0) rows.push(row);

  const widthOf = (r: Card[]): number => r.reduce((sum, c) => sum + c.w, 0) + Math.max(0, r.length - 1) * gutter;
  const heightOf = (r: Card[]): number => r.reduce((max, c) => Math.max(max, c.h), 0);
  const maxW = Math.max(...rows.map(widthOf));
  const totalH = rows.reduce((sum, r) => sum + heightOf(r), 0) + Math.max(0, rows.length - 1) * gutter;
  const scale = Math.min(1 / maxW, 1 / totalH);
  const offX = (1 - maxW * scale) / 2;
  const offY = (1 - totalH * scale) / 2;

  let y = 0;
  for (const r of rows) {
    const h = heightOf(r);
    let x = (maxW - widthOf(r)) / 2;
    for (const c of r) {
      out.set(c.key, { x: offX + x * scale, y: offY + (y + (h - c.h) / 2) * scale, w: c.w * scale, h: c.h * scale });
      x += c.w + gutter;
    }
    y += h + gutter;
  }
  return out;
}

export interface ForceNode {
  readonly id: string;
}

export interface ForceEdge {
  readonly source: string;
  readonly target: string;
  /** Pull strength; 1 when absent. */
  readonly weight?: number;
}

export interface ForceOptions {
  readonly seed?: number | string;
  /** Default 120. The result depends on it, so keep it fixed for a given screen. */
  readonly iterations?: number;
}

/**
 * A Fruchterman-Reingold layout with grid-bucketed repulsion (so a few thousand nodes lay out in well under a second)
 * and a fixed cooling schedule. Positions come back in the unit square, aspect ratio kept, centred. Nodes are visited
 * in id order and edges in (source, target) order; the start positions come from the seeded generator.
 */
export function forceLayout(nodes: readonly ForceNode[], edges: readonly ForceEdge[], options: ForceOptions = {}): Map<string, Point> {
  const ids = nodes.map((node) => node.id).sort(compareKeys);
  const n = ids.length;
  const out = new Map<string, Point>();
  if (n === 0) return out;
  if (n === 1) return out.set(ids[0] ?? "", { x: 0.5, y: 0.5 });

  const iterations = options.iterations ?? 120;
  const index = new Map(ids.map((id, i) => [id, i] as const));
  const pairs = edges
    .map((edge) => ({ a: index.get(edge.source), b: index.get(edge.target), w: edge.weight ?? 1 }))
    .filter((pair): pair is { a: number; b: number; w: number } => pair.a !== undefined && pair.b !== undefined && pair.a !== pair.b)
    .sort((p, q) => p.a - q.a || p.b - q.b);

  const rng = createRng(options.seed ?? 0);
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng()) * 0.5;
    px[i] = 0.5 + Math.cos(angle) * radius;
    py[i] = 0.5 + Math.sin(angle) * radius;
  }

  const k = Math.sqrt(1 / n);
  const reach = 3 * k;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);

  for (let step = 0; step < iterations; step++) {
    const temperature = 0.1 * (1 - step / iterations) + 1e-4;
    dx.fill(0);
    dy.fill(0);

    // Repulsion between nodes in the same or a neighbouring cell.
    const cells = new Map<number, number[]>();
    const cellOf = (v: number): number => Math.floor(v / reach);
    for (let i = 0; i < n; i++) {
      const key = cellOf(px[i] ?? 0) * 100003 + cellOf(py[i] ?? 0);
      const bucket = cells.get(key);
      if (bucket === undefined) cells.set(key, [i]);
      else bucket.push(i);
    }
    for (let i = 0; i < n; i++) {
      const cx = cellOf(px[i] ?? 0);
      const cy = cellOf(py[i] ?? 0);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (const j of cells.get(gx * 100003 + gy) ?? []) {
            if (j <= i) continue;
            let ex = (px[i] ?? 0) - (px[j] ?? 0);
            let ey = (py[i] ?? 0) - (py[j] ?? 0);
            let dist = Math.hypot(ex, ey);
            if (dist < 1e-6) {
              // Coincident: separate along an angle taken from the pair, not from the clock.
              const angle = (hashSeed(ids[i] ?? "", ids[j] ?? "") / 4294967296) * Math.PI * 2;
              ex = Math.cos(angle) * 1e-6;
              ey = Math.sin(angle) * 1e-6;
              dist = 1e-6;
            }
            if (dist > reach) continue;
            const force = (k * k) / dist;
            dx[i] = (dx[i] ?? 0) + (ex / dist) * force;
            dy[i] = (dy[i] ?? 0) + (ey / dist) * force;
            dx[j] = (dx[j] ?? 0) - (ex / dist) * force;
            dy[j] = (dy[j] ?? 0) - (ey / dist) * force;
          }
        }
      }
    }

    // Attraction along edges.
    for (const { a, b, w } of pairs) {
      const ex = (px[a] ?? 0) - (px[b] ?? 0);
      const ey = (py[a] ?? 0) - (py[b] ?? 0);
      const dist = Math.max(Math.hypot(ex, ey), 1e-6);
      const force = ((dist * dist) / k) * w;
      dx[a] = (dx[a] ?? 0) - (ex / dist) * force;
      dy[a] = (dy[a] ?? 0) - (ey / dist) * force;
      dx[b] = (dx[b] ?? 0) + (ex / dist) * force;
      dy[b] = (dy[b] ?? 0) + (ey / dist) * force;
    }

    // A weak pull to the centre keeps disconnected pieces together.
    for (let i = 0; i < n; i++) {
      const gx = (px[i] ?? 0) - 0.5;
      const gy = (py[i] ?? 0) - 0.5;
      const mx = (dx[i] ?? 0) - gx * k * 2;
      const my = (dy[i] ?? 0) - gy * k * 2;
      const length = Math.hypot(mx, my);
      if (length > 0) {
        const move = Math.min(length, temperature);
        px[i] = (px[i] ?? 0) + (mx / length) * move;
        py[i] = (py[i] ?? 0) + (my / length) * move;
      }
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, px[i] ?? 0);
    maxX = Math.max(maxX, px[i] ?? 0);
    minY = Math.min(minY, py[i] ?? 0);
    maxY = Math.max(maxY, py[i] ?? 0);
  }
  const extent = Math.max(maxX - minX, maxY - minY, 1e-9);
  const offsetX = (1 - (maxX - minX) / extent) / 2;
  const offsetY = (1 - (maxY - minY) / extent) / 2;
  ids.forEach((id, i) => {
    out.set(id, { x: offsetX + ((px[i] ?? 0) - minX) / extent, y: offsetY + ((py[i] ?? 0) - minY) / extent });
  });
  return out;
}

export interface CircleItem {
  readonly key: string;
  readonly r: number;
}

export interface PlacedCircle extends CircleItem {
  readonly x: number;
  readonly y: number;
}

export interface CirclePacking {
  readonly circles: PlacedCircle[];
  /** The circle that encloses them all, centred at the origin of the coordinates in `circles`. */
  readonly radius: number;
}

/**
 * Packs circles without overlap: largest first, each placed on a spiral from the centre at the first spot where it
 * touches no earlier one (with `gap` between them). Equal radii are ordered by key. Meant for up to a few hundred
 * circles; the result is centred on its own bounds.
 */
export function packCircles(items: readonly CircleItem[], gap = 0): CirclePacking {
  const sorted = [...items].sort((a, b) => b.r - a.r || compareKeys(a.key, b.key));
  const placed: PlacedCircle[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (const item of sorted) {
    if (placed.length === 0) {
      placed.push({ ...item, x: 0, y: 0 });
      continue;
    }
    const pitch = Math.max(item.r, 1e-6) * 0.25;
    for (let step = 1; ; step++) {
      const distance = pitch * Math.sqrt(step) * 1.4;
      const x = Math.cos(step * golden) * distance;
      const y = Math.sin(step * golden) * distance;
      if (placed.every((c) => Math.hypot(c.x - x, c.y - y) >= c.r + item.r + gap)) {
        placed.push({ ...item, x, y });
        break;
      }
    }
  }
  if (placed.length === 0) return { circles: [], radius: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of placed) {
    minX = Math.min(minX, c.x - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    minY = Math.min(minY, c.y - c.r);
    maxY = Math.max(maxY, c.y + c.r);
  }
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const circles = placed.map((c) => ({ ...c, x: c.x - mx, y: c.y - my }));
  return { circles, radius: Math.max(...circles.map((c) => Math.hypot(c.x, c.y) + c.r)) };
}
