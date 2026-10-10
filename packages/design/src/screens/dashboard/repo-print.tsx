/**
 * The card's print: a small SVG of a handful of regions, drawn solid for kept and dashed for rebuilt. The layout is
 * seeded by the repository's id, so it is the same on every load. It is a pictogram of the two recorded
 * counts, not a map of the repository: the number of cells is fixed by the seed, and how many of them are kept is the
 * recorded kept share, rounded to a cell.
 */

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A small seeded generator (mulberry32): the same seed always yields the same sequence. */
function seeded(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PrintCell {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly kept: boolean;
}

const W = 60;
const H = 40;
const INSET = 2;
const GAP = 3;

/** The print's cells for a repository. Pure: the same arguments give the same cells. */
export function printCells(seedText: string, preserved: number, reconstructed: number): PrintCell[] {
  const random = seeded(hash(seedText));
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  const count = 5 + Math.floor(random() * 5);
  const split = (x: number, y: number, w: number, h: number, n: number, vertical: boolean): void => {
    if (n <= 1 || w < 8 || h < 8) {
      boxes.push({ x, y, w, h });
      return;
    }
    const a = Math.max(1, Math.floor(n * (0.3 + random() * 0.4)));
    const f = a / n;
    if (vertical) {
      split(x, y, w * f, h, a, !vertical);
      split(x + w * f, y, w * (1 - f), h, n - a, !vertical);
    } else {
      split(x, y, w, h * f, a, !vertical);
      split(x, y + h * f, w, h * (1 - f), n - a, !vertical);
    }
  };
  split(INSET, INSET, W, H, count, true);

  const total = preserved + reconstructed;
  let keptCells = total === 0 ? 0 : Math.round((boxes.length * preserved) / total);
  // A kind that was recorded at all keeps at least one cell, so the print never hides a decision that exists.
  if (boxes.length > 1 && preserved > 0 && keptCells === 0) keptCells = 1;
  if (boxes.length > 1 && reconstructed > 0 && keptCells === boxes.length) keptCells = boxes.length - 1;

  // Which cells are kept is a seeded shuffle, not their position.
  const order = boxes.map((_, index) => ({ index, key: random() })).sort((a, b) => a.key - b.key || a.index - b.index);
  const kept = new Set(order.slice(0, keptCells).map((entry) => entry.index));
  return boxes.map((box, index) => ({
    x: box.x + GAP / 2,
    y: box.y + GAP / 2,
    width: Math.max(1, box.w - GAP),
    height: Math.max(1, box.h - GAP),
    kept: kept.has(index),
  }));
}

export interface RepoPrintProps {
  readonly seed: string;
  readonly preserved: number;
  readonly reconstructed: number;
}

export function RepoPrint({ seed, preserved, reconstructed }: RepoPrintProps) {
  const cells = printCells(seed, preserved, reconstructed);
  return (
    <svg className="rh-rc-print" viewBox="0 0 64 44" aria-hidden="true">
      <rect className="rh-pr-frame" x="0.5" y="0.5" width="63" height="43" />
      {cells.map((cell, index) => (
        <rect
          key={index}
          className={cell.kept ? "rh-pr-kept" : "rh-pr-rebuilt"}
          x={cell.x.toFixed(1)}
          y={cell.y.toFixed(1)}
          width={cell.width.toFixed(1)}
          height={cell.height.toFixed(1)}
        />
      ))}
    </svg>
  );
}
