/**
 * The model behind the Hive landing: one hexagonal cell per file, placed three ways (the flat graph, the honeycomb)
 * and tied to the hierarchy's rings. Pure functions of `LandingFigures`; nothing here touches the DOM or three.js, and
 * nothing reads the clock, so the same figures give the same cells on every visit.
 *
 * Ported from the approved Hive Core artifact (`hive.js`), keeping its numbers.
 */
import type { ArcKindCode, ArcRow, LandingFigures } from "../landing/figures-types";

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
/** Smoothstep on 0 to 1. */
export const sm = (t: number): number => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const number = new Intl.NumberFormat("en-US");

/** The decision words the pieces and the readout use, indexed by `ArcKindCode`. */
export const KIND_WORDS = ["Group", "Kept as written", "Rebuilt from dependencies", "Too small to measure"] as const;

/** Park-Miller, seeded: the same stream on every visit. */
function seeded(seed: number): () => number {
  let x = seed;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
}

export interface HiveModel {
  /** Files, so cells. */
  readonly n: number;
  /** Leaf nodes of the containment map: the regions the third plate shows. */
  readonly leaves: number;
  /** Per file: where its region sits in the leaf order, its decision, its index in that leaf. */
  readonly kindOf: Uint8Array;
  readonly subOf: Int32Array;
  /** The level-1 and level-2 group a file sits under, as map indexes. */
  readonly anc1: Int32Array;
  readonly anc2: Int32Array;
  /** Per file, from a fixed seed: when its cell moves, its wobble phase, a jitter inside its ring band, a tint. */
  readonly delay: Float32Array;
  readonly phase: Float32Array;
  readonly jit: Float32Array;
  readonly tint: Float32Array;
  /** Cell centres (x, z pairs) in a unit space about 1 across: the flat graph and the honeycomb. */
  readonly flat: Float32Array;
  readonly hive: Float32Array;
  /** The hex radius that fills the unit disc with `n` cells. */
  readonly hexS: number;
  /** Each file's place around the sunburst, 0 to 1. */
  readonly frac: Float32Array;
}

const cache = new WeakMap<LandingFigures, HiveModel>();

export function buildHiveModel(figures: LandingFigures): HiveModel {
  const hit = cache.get(figures);
  if (hit !== undefined) return hit;
  const model = build(figures);
  cache.set(figures, model);
  return model;
}

function build(figures: LandingFigures): HiveModel {
  const { map } = figures;
  const n = figures.flat.points.length;

  // Tree: children in recorded order, leaves depth first; files are dealt to leaves in that order.
  const kids = new Map<number, number[]>();
  map.forEach((row, i) => {
    if (row[0] >= 0) {
      const list = kids.get(row[0]);
      if (list === undefined) kids.set(row[0], [i]);
      else list.push(i);
    }
  });
  kids.forEach((list) => list.sort((a, b) => (map[a]?.[2] ?? 0) - (map[b]?.[2] ?? 0)));
  const depth = new Int32Array(map.length);
  const leaves: number[] = [];
  const walk = (i: number, d: number): void => {
    depth[i] = d;
    const children = kids.get(i);
    if (children === undefined) {
      leaves.push(i);
      return;
    }
    children.forEach((child) => walk(child, d + 1));
  };
  walk(0, 0);

  const leafOf = new Int32Array(n);
  const kindOf = new Uint8Array(n);
  const idxIn = new Int32Array(n);
  const nodeOf = new Int32Array(n);
  let p = 0;
  leaves.forEach((leaf, li) => {
    const row = map[leaf]!;
    for (let j = 0; j < row[1] && p < n; j++, p++) {
      leafOf[p] = li;
      kindOf[p] = row[3];
      idxIn[p] = j;
      nodeOf[p] = leaf;
    }
  });
  for (; p < n; p++) {
    const li = leaves.length - 1;
    leafOf[p] = li;
    kindOf[p] = map[leaves[li]!]![3];
    idxIn[p] = p;
    nodeOf[p] = leaves[li]!;
  }

  /** The node that holds file `f` at tree depth `d` (1 is a top-level group). */
  const ancestor = (f: number, d: number): number => {
    let node = nodeOf[f]!;
    while (depth[node]! > d) node = map[node]![0];
    return node;
  };
  const anc1 = new Int32Array(n);
  const anc2 = new Int32Array(n);
  for (let f = 0; f < n; f++) {
    anc1[f] = ancestor(f, 1);
    anc2[f] = ancestor(f, 2);
  }
  // Inside a rebuilt region, files fall into groups of at most `maxGroupSize`.
  const subOf = new Int32Array(n);
  for (let f = 0; f < n; f++) subOf[f] = kindOf[f] === 2 ? Math.floor(idxIn[f]! / figures.settings.maxGroupSize) : 0;

  const rnd = seeded(7);
  const delay = new Float32Array(n);
  const phase = new Float32Array(n);
  const jit = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    delay[i] = rnd();
    phase[i] = rnd() * Math.PI * 2;
    jit[i] = rnd();
  }
  const tint = new Float32Array(n);
  for (let i = 0; i < n; i++) tint[i] = ((leafOf[i]! * 37) % 11) / 11;

  const flat = new Float32Array(n * 2);
  figures.flat.points.forEach((pt, i) => {
    flat[i * 2] = (pt[0] - 500) / 470;
    flat[i * 2 + 1] = (pt[1] - 504) / 470;
  });

  // The honeycomb: the cells nearest the centre, ordered along a Hilbert curve so each region stays in one piece.
  const R = 1.0;
  const hexS = R * Math.sqrt(Math.PI / (n * 2.598)) * 1.02;
  const w = Math.sqrt(3) * hexS;
  const h = 1.5 * hexS;
  const rows = Math.ceil((R * 1.3) / h);
  const cells: [number, number, number, number][] = [];
  for (let r = -rows; r <= rows; r++) {
    for (let q = -rows * 2; q <= rows * 2; q++) {
      const x = q * w + (r & 1 ? w / 2 : 0);
      const y = r * h;
      cells.push([x, y, x * x + y * y, 0]);
    }
  }
  cells.sort((a, b) => a[2] - b[2]);
  cells.length = n;
  const hilbert = (px: number, py: number): number => {
    let x = px;
    let y = py;
    let d = 0;
    for (let s = 512; s > 0; s >>= 1) {
      const rx = (x & s) > 0 ? 1 : 0;
      const ry = (y & s) > 0 ? 1 : 0;
      d += s * s * ((3 * rx) ^ ry);
      if (ry === 0) {
        if (rx === 1) {
          x = 1023 - x;
          y = 1023 - y;
        }
        const t = x;
        x = y;
        y = t;
      }
    }
    return d;
  };
  cells.forEach((c) => {
    c[3] = hilbert(Math.floor(((c[0] + 1.2) / 2.4) * 1023), Math.floor(((c[1] + 1.2) / 2.4) * 1023));
  });
  cells.sort((a, b) => a[3] - b[3]);
  const hive = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    hive[i * 2] = cells[i]![0];
    hive[i * 2 + 1] = cells[i]![1];
  }

  const frac = new Float32Array(n);
  for (let f = 0; f < n; f++) frac[f] = (f + 0.5) / n;

  return { n, leaves: leaves.length, kindOf, subOf, anc1, anc2, delay, phase, jit, tint, flat, hive, hexS, frac };
}

// ---- the hierarchy as arcs: which pieces are drawn, and how they nest ----

/** Ring geometry shared by the animation and the explorer, in scene units. */
export const RING = { r0: 1.15, width: 0.95, gap: 0.07, height: 0.34, level: 1.3 } as const;

export interface Strata {
  readonly arcs: readonly ArcRow[];
  /** Whether an arc is wide enough to draw. */
  readonly drawn: readonly boolean[];
  /** The recorded arc one ring in that holds each arc, or -1. */
  readonly parentOf: readonly number[];
  readonly childCount: readonly number[];
  /** The recorded arc on `ring` that covers sweep position `t`, or -1. */
  arcAt(ring: number, t: number): number;
  /** The recorded count of arcs per ring: what the labels and the readout say, drawn or not. */
  readonly perRing: Readonly<Record<1 | 2 | 3 | 4, number>>;
  readonly total: number;
}

const strataCache = new WeakMap<LandingFigures, Strata>();

export function buildStrata(figures: LandingFigures): Strata {
  const hit = strataCache.get(figures);
  if (hit !== undefined) return hit;
  const A = figures.arcs;
  const drawn = A.map(([ring, , span]) => {
    if (span < 0.0012) return false;
    const r0 = RING.r0 + (ring - 1) * (RING.width + RING.gap);
    const pad = Math.min(span * Math.PI * 0.25, (0.012 / r0) * 4);
    return span * Math.PI * 2 - 2 * pad > 0.0005;
  });
  const byRing: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [] };
  A.forEach((a, k) => byRing[a[0]]!.push(k));
  for (const ring of [1, 2, 3, 4]) byRing[ring]!.sort((a, b) => A[a]![1] - A[b]![1]);
  const arcAt = (ring: number, t: number): number => {
    const list = byRing[ring]!;
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (A[list[mid]!]![1] <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0) return -1;
    const a = A[list[found]!]!;
    return t < a[1] + a[2] ? list[found]! : -1;
  };
  const parentOf = A.map((a) => (a[0] > 1 ? arcAt(a[0] - 1, a[1] + a[2] / 2) : -1));
  const childCount = A.map(() => 0);
  parentOf.forEach((p) => {
    if (p >= 0) childCount[p] = childCount[p]! + 1;
  });
  const perRing = { 1: 0, 2: 0, 3: 0, 4: 0 };
  A.forEach((a) => {
    perRing[a[0] as 1 | 2 | 3 | 4]++;
  });
  const strata: Strata = { arcs: A, drawn, parentOf, childCount, arcAt, perRing, total: A.length };
  strataCache.set(figures, strata);
  return strata;
}

/** How tall a piece stands: kept regions tall, rebuilt ones at the base height, the too-small ones low. */
export const pieceHeight = (kind: ArcKindCode): number => RING.height * (kind === 1 ? 1.9 : kind === 3 ? 0.6 : 1);

const ringNoun = (ring: number): string => (ring <= 2 ? "groups" : "pieces");

/** The five labels on the stack: the repository, then one per level. `count` is bold. */
export interface RingLabel {
  readonly before: string;
  readonly count: string;
  readonly after: string;
}

export function ringLabels(figures: LandingFigures, strata: Strata): RingLabel[] {
  return [
    { before: "Repository · ", count: number.format(figures.counts.files), after: " files" },
    ...([1, 2, 3, 4] as const).map((ring) => ({ before: `Level ${ring} · `, count: number.format(strata.perRing[ring]), after: ` ${ringNoun(ring)}` })),
  ];
}

// ---- the explorer's readout ----

export type SwatchKind = "g" | "k" | "r" | "u";
const SWATCH: readonly SwatchKind[] = ["g", "k", "r", "u"];

/** What the explorer's side panel says about one piece, or about the repository when `k` is -1. */
export interface Readout {
  readonly level: string;
  readonly files: string;
  readonly swatch: SwatchKind;
  readonly tag: string;
  readonly share: string;
  readonly inside: string;
  readonly below: string;
  readonly hint: string;
}

export const READOUT_HINT = "Hover a piece to read it. Click it to follow its branch; click empty space to clear.";

/**
 * `k` is the arc to describe (-1 for the repository), `selected` whether it is the clicked piece, and `lit` how many
 * pieces the followed branch lights, or 0 when none is followed.
 */
export function readoutFor(figures: LandingFigures, strata: Strata, k: number, selected: boolean, lit: number): Readout {
  const hint = lit > 0 ? `Following this branch: ${lit} pieces lit. Click empty space or press Escape to clear.` : READOUT_HINT;
  if (k < 0) {
    return {
      level: "Repository",
      files: number.format(figures.counts.files),
      swatch: "k",
      tag: figures.repository,
      share: "100% of the repository",
      inside: "Nothing; this is the top",
      below: `${strata.perRing[1]} groups on level 1`,
      hint,
    };
  }
  const [ring, , , files, kind] = strata.arcs[k]!;
  const parent = strata.parentOf[k]!;
  const share = (files / figures.counts.files) * 100;
  const kids = strata.childCount[k]!;
  return {
    level: `Level ${ring}${selected ? " · selected" : ""}`,
    files: number.format(files),
    swatch: SWATCH[kind]!,
    tag: KIND_WORDS[kind]!,
    share: `${share < 1 ? share.toFixed(2) : share.toFixed(1)}% of the repository`,
    inside: ring === 1 ? "The repository" : parent >= 0 ? `A level-${ring - 1} piece of ${number.format(strata.arcs[parent]![3])} files` : "Not recorded",
    below: ring === 4 ? "Files and their functions, not drawn here" : kids ? `${kids} ${kids === 1 ? "piece" : "pieces"} on level ${ring + 1}` : `Nothing on level ${ring + 1}`,
    hint,
  };
}

/** A piece, every piece above it and every piece below it. */
export function branchOf(strata: Strata, k: number): Set<number> {
  const set = new Set<number>([k]);
  let p = strata.parentOf[k]!;
  while (p >= 0) {
    set.add(p);
    p = strata.parentOf[p]!;
  }
  const ring = strata.arcs[k]![0];
  strata.arcs.forEach((a, j) => {
    if (a[0] <= ring) return;
    let q = strata.parentOf[j]!;
    while (q >= 0) {
      if (q === k) {
        set.add(j);
        break;
      }
      q = strata.parentOf[q]!;
    }
  });
  return set;
}
