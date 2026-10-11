/**
 * The film's scene: everything about it that does not depend on time, built once from the landing figures.
 *
 * Story, on a 1600 by 1000 stage: a flat graph of files sorts into four packages, each scored against one boundary;
 * three are kept (ink tiles fill solid); the tangled one is rebuilt into four communities (accent); that is the mark;
 * the camera dives into one community down to its files; the same files then become three of the views, the hierarchy
 * sunburst, the decisions strip and the architecture matrix; and everything dissolves back. Ink is what the developer
 * wrote, accent is what RepoHIVE computed.
 *
 * Every value that comes from the repository (scores, ring sweeps, matrix cells, group ids) is read from the figures;
 * the rest is geometry and timing. The layout is seeded, so identical figures give an identical scene.
 */
import type { LandingFigures } from "../figures-types";
import { PI, TAU, expoInOut, mulberry, seg } from "./film-math";

export const VW = 1600;
export const VH = 1000;
/** Seconds in one pass of the film. */
export const LOOP = 41;
/** The frame shown when motion is reduced, and for thumbnails. */
export const STILL = 27.9;

export const T = { sort: 3.9, score: 7.9, keep: 12.2, rb: 15.6, zoom: 20.0, sun: 24.8, dec: 29.5, dsm: 34.2, out: 38.3 } as const;

export interface Chapter {
  readonly label: string;
  readonly range: readonly [number, number];
}
export const CHAPTERS: readonly Chapter[] = [
  { label: "Graph", range: [0, 3.9] },
  { label: "Regions", range: [3.9, 7.9] },
  { label: "Score", range: [7.9, 12.2] },
  { label: "Keep", range: [12.2, 15.6] },
  { label: "Rebuild", range: [15.6, 20.0] },
  { label: "Zoom", range: [20.0, 24.8] },
  { label: "Hierarchy", range: [24.8, 29.5] },
  { label: "Decisions", range: [29.5, 34.2] },
  { label: "Architecture", range: [34.2, 41] },
];

/** The mark's grid: 24 units, three 10 by 10 kept regions, one region rebuilt into four 4 by 4 communities. */
export const U = 24;
export const LCX = 1060;
export const LCY = 500;
export const OX = LCX - 12 * U;
export const OY = LCY - 12 * U;
export const X = (u: number): number => OX + u * U;
export const Y = (u: number): number => OY + u * U;
export const BLOCKS: readonly (readonly [number, number])[] = [
  [13, 1],
  [19, 1],
  [13, 7],
  [19, 7],
];
/** The community the camera dives into. */
export const ZB = 3;
export const ZS = 5.8;
export const ZF = { x: X(BLOCKS[ZB]![0] + 2), y: Y(BLOCKS[ZB]![1] + 2) };

export interface Quad {
  readonly x: number;
  readonly y: number;
  readonly name: string;
  readonly score: number;
  readonly side: -1 | 1;
}

export interface FilmNode {
  /** Package (0..2 kept, 3 rebuilt). */
  readonly q: number;
  /** Community and member of a rebuilt package, -1 for kept. */
  readonly k: number;
  readonly m: number;
  readonly gx: number;
  readonly gy: number;
  readonly lx: number;
  readonly ly: number;
  readonly d: number;
  readonly r: number;
  readonly r2: number;
}

/** Edge types: 0 inside a kept package, 1 between kept, 2 inside a community, 3 between communities, 4 util to kept. */
export interface FilmEdge {
  readonly a: number;
  readonly b: number;
  readonly type: 0 | 1 | 2 | 3 | 4;
  readonly r: number;
}

export interface Card {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly n: number;
  readonly cols: number;
  readonly id: string;
}

export interface Leaf {
  readonly f: number;
  readonly k: number;
}
export interface Arc {
  readonly d: number;
  readonly a0: number;
  readonly a1: number;
  readonly k: number;
}
export interface Dot {
  readonly x: number;
  readonly y: number;
  readonly s: number;
}
export interface DsmCell {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly k: number;
  readonly band: boolean;
}

export const SEL = 4;
export const RELATED: readonly number[] = [1, 7, 13];

export const SUN_R0 = 70;
export const SUN_RING = 56;
export const SUN_LEAF = SUN_R0 + 3.5 * SUN_RING;
export const DEC_X0 = 700;
export const DEC_X1 = 1420;
export const DEC_Y = 650;
export const DOT = 10;

export interface FilmScene {
  readonly quads: readonly Quad[];
  readonly nodes: readonly FilmNode[];
  readonly edges: readonly FilmEdge[];
  /** Where each file sits in the flat graph. */
  readonly tx: Float64Array;
  readonly ty: Float64Array;
  readonly cards: readonly Card[];
  readonly filePos: readonly { readonly x: number; readonly y: number }[];
  readonly selName: string;
  readonly arcs: readonly Arc[];
  readonly foc: { readonly a0: number; readonly a1: number };
  /** Which file becomes which sunburst leaf, decision dot, matrix cell (by node index); undefined when none. */
  readonly su: readonly (Leaf | undefined)[];
  readonly de: readonly (Dot | undefined)[];
  readonly dc: readonly (DsmCell | undefined)[];
  readonly dsm: { readonly n: number; readonly cell: number; readonly blocks: LandingFigures["dsm"]["blocks"]; readonly hb: readonly [number, number, number] };
  /** The recorded decision boundary the decisions strip starts at. */
  readonly boundary: number;
}

function clockAng(x: number, y: number): number {
  const a = Math.atan2(y - 12, x - 12) + PI / 2;
  return a < 0 ? a + TAU : a;
}

/** Item j goes to file order[floor(j*n/m)], so the spares fall evenly. */
function spread<T>(order: readonly number[], items: readonly T[], out: (T | undefined)[]): void {
  for (let j = 0; j < items.length && j < order.length; j++) out[order[Math.floor((j * order.length) / items.length)]!] = items[j];
}

export function buildScene(figures: LandingFigures): FilmScene {
  const R = mulberry(figures.settings.seed);

  // ---- the four regions, read from the figures -------------------------------------------------------------------
  const score = (name: string): number => {
    const row = figures.regions.find((r) => r[0] === name);
    if (row === undefined) throw new Error(`film: the figures have no measured region "${name}"`);
    return row[4];
  };
  const [k0, k1, k2] = figures.featured.kept as readonly [string, string, string];
  const quads: Quad[] = [
    { x: 1, y: 1, name: k0, score: score(k0), side: -1 },
    { x: 1, y: 13, name: k1, score: score(k1), side: 1 },
    { x: 13, y: 13, name: k2, score: score(k2), side: 1 },
    { x: 13, y: 1, name: figures.featured.rebuilt, score: score(figures.featured.rebuilt), side: -1 },
  ];

  // ---- files -----------------------------------------------------------------------------------------------------
  const nodes: FilmNode[] = [];
  for (let q = 0; q < 3; q++) {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        const gx = quads[q]!.x + c + 0.5;
        const gy = quads[q]!.y + r + 0.5;
        nodes.push({ q, k: -1, m: -1, gx, gy, lx: gx, ly: gy, d: r + c, r: R(), r2: R() });
      }
    }
  }
  const cells: number[] = [];
  for (let i = 0; i < 100; i++) cells.push(i);
  for (let i = 99; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    const tmp = cells[i]!;
    cells[i] = cells[j]!;
    cells[j] = tmp;
  }
  for (let k = 0; k < 4; k++) {
    for (let m = 0; m < 16; m++) {
      const cell = cells[k * 16 + m]!;
      const b = BLOCKS[k]!;
      nodes.push({
        q: 3,
        k,
        m,
        gx: b[0] + (m % 4) + 0.5,
        gy: b[1] + Math.floor(m / 4) + 0.5,
        lx: 13 + (cell % 10) + 0.5 + (R() - 0.5) * 0.34,
        ly: 1 + Math.floor(cell / 10) + 0.5 + (R() - 0.5) * 0.34,
        d: (m % 4) + Math.floor(m / 4),
        r: R(),
        r2: R(),
      });
    }
  }
  const NN = nodes.length;

  // ---- dependencies ----------------------------------------------------------------------------------------------
  const edges: FilmEdge[] = [];
  const E = (a: number, b: number, type: FilmEdge["type"]): void => {
    if (a !== b) edges.push({ a, b, type, r: R() });
  };
  for (let q = 0; q < 3; q++) {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        const i = q * 100 + r * 10 + c;
        if (c < 9 && R() < 0.34) E(i, i + 1, 0);
        if (r < 9 && R() < 0.34) E(i, i + 10, 0);
      }
    }
    for (let j = 0; j < 9; j++) E(q * 100 + Math.floor(R() * 100), q * 100 + Math.floor(R() * 100), 0);
  }
  for (const p of [
    [0, 1],
    [0, 2],
    [1, 2],
  ] as const) {
    for (let n = 0; n < 4; n++) E(p[0] * 100 + Math.floor(R() * 100), p[1] * 100 + Math.floor(R() * 100), 1);
  }
  for (let k = 0; k < 4; k++) for (let j = 0; j < 17; j++) E(300 + k * 16 + Math.floor(R() * 16), 300 + k * 16 + Math.floor(R() * 16), 2);
  for (let j = 0; j < 6; j++) E(300 + Math.floor(R() * 64), 300 + Math.floor(R() * 64), 3);
  for (let j = 0; j < 36; j++) E(300 + Math.floor(R() * 64), Math.floor(R() * 300), 4);

  // ---- the flat graph: a seeded force layout, fitted to a 330 px disc around the mark's centre -------------------------
  const tx = new Float64Array(NN);
  const ty = new Float64Array(NN);
  {
    const px = new Float64Array(NN);
    const py = new Float64Array(NN);
    const dx = new Float64Array(NN);
    const dy = new Float64Array(NN);
    const L = mulberry(7);
    for (let i = 0; i < NN; i++) {
      const a = L() * TAU;
      const rr = Math.sqrt(L());
      px[i] = Math.cos(a) * rr;
      py[i] = Math.sin(a) * rr;
    }
    const kk = Math.sqrt(PI / NN);
    const k2 = kk * kk;
    const IT = 220;
    for (let it = 0; it < IT; it++) {
      dx.fill(0);
      dy.fill(0);
      for (let i = 0; i < NN; i++) {
        for (let j = i + 1; j < NN; j++) {
          const ex = px[i]! - px[j]!;
          const ey = py[i]! - py[j]!;
          const f = k2 / (ex * ex + ey * ey + 1e-6);
          dx[i]! += ex * f;
          dy[i]! += ey * f;
          dx[j]! -= ex * f;
          dy[j]! -= ey * f;
        }
      }
      for (const e of edges) {
        const fx = px[e.a]! - px[e.b]!;
        const fy = py[e.a]! - py[e.b]!;
        const g = (Math.sqrt(fx * fx + fy * fy) + 1e-6) / kk;
        dx[e.a]! -= fx * g;
        dy[e.a]! -= fy * g;
        dx[e.b]! += fx * g;
        dy[e.b]! += fy * g;
      }
      const temp = 0.1 * (1 - it / IT) + 0.002;
      for (let i = 0; i < NN; i++) {
        dx[i]! -= px[i]! * 0.7;
        dy[i]! -= py[i]! * 0.7;
        const dl = Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!) + 1e-9;
        const s = Math.min(dl, temp) / dl;
        px[i]! += dx[i]! * s;
        py[i]! += dy[i]! * s;
      }
    }
    let mx = 0;
    let my = 0;
    for (let i = 0; i < NN; i++) {
      mx += px[i]!;
      my += py[i]!;
    }
    mx /= NN;
    my /= NN;
    const rs: number[] = [];
    for (let i = 0; i < NN; i++) rs.push(Math.hypot(px[i]! - mx, py[i]! - my));
    rs.sort((a, b) => a - b);
    const sc = 320 / rs[Math.floor(NN * 0.96)]!;
    for (let i = 0; i < NN; i++) {
      tx[i] = LCX + (px[i]! - mx) * sc;
      ty[i] = LCY + (py[i]! - my) * sc;
    }
  }

  // ---- inside one community: four groups of files, as the map draws them ----------------------------------------------
  const geometry = [
    { x: 0.22, y: 0.22, w: 2.16, h: 2.1, n: 6, cols: 3 },
    { x: 2.56, y: 0.22, w: 1.22, h: 2.1, n: 3, cols: 1 },
    { x: 0.22, y: 2.5, w: 1.5, h: 1.28, n: 3, cols: 2 },
    { x: 1.9, y: 2.5, w: 1.88, h: 1.28, n: 4, cols: 2 },
  ] as const;
  const cards: Card[] = geometry.map((g, i) => ({ ...g, id: figures.zoom.groups[i]?.id ?? "" }));
  const filePos: { x: number; y: number }[] = [];
  for (const cd of cards) {
    const rows = Math.ceil(cd.n / cd.cols);
    const y0 = cd.y + 0.36;
    const cy = y0 + (cd.h - 0.36) / 2;
    for (let i = 0; i < cd.n; i++) {
      const row = Math.floor(i / cd.cols);
      const inRow = Math.min(cd.cols, cd.n - row * cd.cols);
      const col = i - row * cd.cols;
      filePos.push({ x: cd.x + cd.w / 2 + (col - (inRow - 1) / 2) * 0.56, y: cy + (row - (rows - 1) / 2) * 0.56 });
    }
  }
  const selName = figures.zoom.groups[0]?.sample ?? "";

  // ---- three views, drawn from the index. The mark's files travel into each one -------------------------------------
  const ORD: number[] = [];
  for (let i = 0; i < NN; i++) ORD.push(i);
  ORD.sort((a, b) => clockAng(nodes[a]!.gx, nodes[a]!.gy) - clockAng(nodes[b]!.gx, nodes[b]!.gy) || a - b);

  // hierarchy: a sunburst of four rings; each leaf takes one file
  const arcs: Arc[] = figures.arcs.map((a) => ({ d: a[0], a0: a[1], a1: a[1] + a[2], k: a[4] }));
  const leaves: Leaf[] = arcs
    .filter((a) => a.d === 4)
    .sort((a, b) => a.a0 - b.a0)
    .map((a) => ({ f: (a.a0 + a.a1) / 2, k: a.k }));
  const foc = arcs.filter((a) => a.d === 2).sort((a, b) => b.a1 - b.a0 - (a.a1 - a.a0))[0] ?? { a0: 0, a1: 0 };
  const su: (Leaf | undefined)[] = new Array<Leaf | undefined>(NN).fill(undefined);
  spread(ORD, leaves, su);

  // decisions: every measured region on one score axis, stacked where they collide
  const colN = new Map<number, number>();
  const dots: Dot[] = figures.regions
    .map((r) => r[4])
    .sort((a, b) => a - b)
    .map((s) => {
      const cx = Math.round((DEC_X0 + s * (DEC_X1 - DEC_X0)) / DOT) * DOT;
      const k = (colN.get(cx) ?? 0) + 1;
      colN.set(cx, k);
      return { x: cx, y: DEC_Y - DOT / 2 - 3 - (k - 1) * DOT, s };
    })
    .sort((a, b) => a.x - b.x || b.y - a.y);
  const sunX = (i: number): number => {
    const s = su[i];
    return s !== undefined ? Math.cos(s.f * TAU - PI / 2) : (nodes[i]!.gx - 12) / 12;
  };
  const ORD2 = ORD.slice().sort((a, b) => sunX(a) - sunX(b) || a - b);
  const de: (Dot | undefined)[] = new Array<Dot | undefined>(NN).fill(undefined);
  spread(ORD2, dots, de);

  // architecture: the group matrix on the mark's own 24-unit square
  const D = figures.dsm;
  const CELL = (24 * U) / D.n;
  const DX0 = X(0);
  const DY0 = Y(0);
  const hb = (D.blocks[3] ?? [0, 0, 1]) as readonly [number, number, number];
  const blockOf = (g: number): LandingFigures["dsm"]["blocks"][number] | undefined => D.blocks.find((b) => g >= b[0] && g < b[0] + b[1]);
  const dsmCells: DsmCell[] = D.entries
    .map((e) => {
      const br = blockOf(e[0]);
      const inB = br !== undefined && br === blockOf(e[1]);
      const band = (e[0] >= hb[0] && e[0] < hb[0] + hb[1]) || (e[1] >= hb[0] && e[1] < hb[0] + hb[1]);
      return { x: DX0 + (e[1] + 0.5) * CELL, y: DY0 + (e[0] + 0.5) * CELL, w: 0.25 + 0.75 * Math.sqrt(e[2] / D.max), k: inB ? br[2] : 0, band };
    })
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const ORD3 = ORD.filter((i) => de[i] !== undefined).sort((a, b) => de[a]!.x - de[b]!.x || a - b);
  const dc: (DsmCell | undefined)[] = new Array<DsmCell | undefined>(NN).fill(undefined);
  spread(ORD3, dsmCells, dc);

  return { quads, nodes, edges, tx, ty, cards, filePos, selName, arcs, foc, su, de, dc, dsm: { n: D.n, cell: CELL, blocks: D.blocks, hb }, boundary: figures.settings.boundary };
}

/** The decisions strip's boundary over time: the recorded one, which slides up to 0.62 and back. */
export function boundaryAt(t: number, recorded: number): number {
  return recorded + 0.12 * expoInOut(seg(t, 31.6, 32.5)) - 0.12 * expoInOut(seg(t, 33.1, 33.8));
}
