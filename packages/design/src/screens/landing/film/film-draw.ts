/**
 * One frame of the film. `drawFilm` is a pure function of time: given the scene, a time `t` and the colours, it paints
 * the same pixels every time. Pausing stops the clock, scrubbing picks a `t`; nothing in here reads a clock, a random
 * number or the page. Colours arrive as resolved tokens (`FilmColors`), never as literals.
 */
import { mixColors as mixc, rgbaCss, type Rgba } from "../../../canvas/colors";
import { PI, TAU, backOut, bump, expoIn, expoInOut, expoOut, lerp, seg } from "./film-math";
import {
  BLOCKS,
  DEC_X0,
  DEC_X1,
  DEC_Y,
  LCX,
  LCY,
  LOOP,
  RELATED,
  SEL,
  SUN_LEAF,
  SUN_R0,
  SUN_RING,
  T,
  U,
  X,
  Y,
  ZB,
  ZF,
  ZS,
  boundaryAt,
  type FilmEdge,
  type FilmScene,
} from "./film-scene";

/** The tokens a frame paints with, resolved to numbers. */
export interface FilmColors {
  /** The ground the film sits on. */
  readonly g: Rgba;
  readonly ink: Rgba;
  readonly fg2: Rgba;
  readonly fg3: Rgba;
  readonly line: Rgba;
  readonly ls: Rgba;
  readonly acc: Rgba;
  readonly surf: Rgba;
}

/** The two computed font stacks (`CanvasPalette.sans` and `.mono`). */
export interface FilmFonts {
  readonly sans: string;
  readonly mono: string;
}

export interface FilmOptions {
  /** The part of the 1600 by 1000 stage that fills the canvas. */
  readonly core?: { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number };
}

const DEFAULT_CORE = { cx: 800, cy: 500, w: 1360, h: 800 } as const;

interface Camera {
  readonly S: number;
  readonly fx: number;
  readonly fy: number;
  readonly z: number;
}

interface NodeState {
  x: number;
  y: number;
  s: number;
  round: number;
  col: Rgba;
  a: number;
}

const css = rgbaCss;
const quad = (a: number, c: number, b: number, p: number): number => {
  const o = 1 - p;
  return o * o * a + 2 * o * p * c + p * p * b;
};

function camera(t: number): Camera {
  const z = expoInOut(seg(t, 20.15, 21.65)) * (1 - expoInOut(seg(t, 23.65, 24.85)));
  const S = Math.exp(Math.log(ZS) * z);
  const w = 1 - (1 - z) / S;
  return { S, fx: lerp(LCX, ZF.x, w), fy: lerp(LCY, ZF.y, w), z };
}

const sunRot = (t: number): number => -0.5 * (1 - expoOut(seg(t, 24.95, 27.8)));
function sunXY(f: number, r: number, t: number): { x: number; y: number } {
  const th = f * TAU - PI / 2 + sunRot(t);
  return { x: LCX + Math.cos(th) * r, y: LCY + Math.sin(th) * r };
}
function arc2(x0: number, y0: number, x1: number, y1: number, bend: number, p: number): { x: number; y: number } {
  const cx = (x0 + x1) / 2 - (y1 - y0) * bend;
  const cy = (y0 + y1) / 2 + (x1 - x0) * bend;
  return { x: quad(x0, cx, x1, p), y: quad(y0, cy, y1, p) };
}
function kindCol(C: FilmColors, k: number): Rgba {
  return k === 1 ? C.ink : k === 2 ? C.acc : k === 3 ? C.ls : mixc(C.g, C.ink, 0.12);
}
const crossA = (t: number): number => expoInOut(seg(t, 36.4, 36.8)) * (1 - expoInOut(seg(t, 37.4, 37.8)));

/** Where file `i` is, how big, how round, how computed. */
function nodeState(scene: FilmScene, i: number, t: number, cam: Camera, C: FilmColors): NodeState {
  const n = scene.nodes[i]!;
  const drift = 4.5;
  const tx = scene.tx[i]! + drift * Math.sin(TAU * ((2 * t) / LOOP) + n.r * TAU);
  const ty = scene.ty[i]! + drift * Math.cos(TAU * ((3 * t) / LOOP) + n.r2 * TAU);
  const lx = X(n.lx);
  const ly = Y(n.ly);
  const gx = X(n.gx);
  const gy = Y(n.gy);
  const dot = 7.5;
  const loose = 0.36 * U;
  const full = U + 0.7;
  // 1. sort the flat graph into packages, along a slight arc
  const sd = T.sort + n.q * 0.16 + n.r * 0.55;
  const p1 = expoInOut(seg(t, sd, sd + 1.45));
  const cx1 = (tx + lx) / 2 + (ly - ty) * (n.r2 - 0.5) * 0.45;
  const cy1 = (ty + ly) / 2 + (tx - lx) * (n.r2 - 0.5) * 0.45;
  let x = quad(tx, cx1, lx, p1);
  let y = quad(ty, cy1, ly, p1);
  let size = lerp(dot, loose, p1);
  let round = 1;
  let acc = 0;
  let alpha = 1;
  if (n.q < 3) {
    const fd = T.keep + 0.3 + n.q * 0.3 + n.d * 0.045;
    const fp = seg(t, fd, fd + 0.75);
    if (fp > 0) {
      size = lerp(loose, full, backOut(fp));
      round = 1 - expoOut(fp);
    }
  } else {
    acc = expoOut(seg(t, 15.8 + n.r * 0.5, 16.3 + n.r * 0.5));
    const cd = 16.55 + n.k * 0.12 + n.m * 0.018;
    const p2 = expoInOut(seg(t, cd, cd + 1.3));
    if (p2 > 0) {
      const cx2 = (lx + gx) / 2 + (gy - ly) * 0.25;
      const cy2 = (ly + gy) / 2 - (gx - lx) * 0.25;
      x = quad(lx, cx2, gx, p2);
      y = quad(ly, cy2, gy, p2);
    }
    const fd2 = 18.15 + n.k * 0.14 + n.d * 0.06;
    const fq = seg(t, fd2, fd2 + 0.7);
    if (fq > 0) {
      size = lerp(loose, full, backOut(fq));
      round = 1 - expoOut(fq);
    }
    // zoom: the dived-into community opens into its files
    if (n.k === ZB) {
      const zs = seg(t, 20.25 + n.m * 0.012, 21.35 + n.m * 0.012);
      const zb = seg(t, 23.6 + n.m * 0.015, 24.4 + n.m * 0.015);
      const zp = expoInOut(zs) * (1 - expoInOut(zb));
      const zq = expoOut(Math.min(1, zs * 1.6)) * (1 - expoIn(zb));
      if (zp > 0) {
        const f = scene.filePos[n.m]!;
        x = lerp(x, X(BLOCKS[ZB]![0] + f.x), zp);
        y = lerp(y, Y(BLOCKS[ZB]![1] + f.y), zp);
        size = lerp(size, 0.36 * U, zq);
        round = lerp(round, 0.22, zq);
        const sel = seg(t, 22.75, 22.95) * (1 - seg(t, 23.3, 23.6));
        if (n.m !== SEL && !RELATED.includes(n.m)) alpha = 1 - 0.75 * sel;
      }
    } else alpha = -cam.z;
  }
  if (n.q < 3) alpha = -cam.z;
  let col = mixc(C.ink, C.acc, acc);

  // 7. hierarchy: each file swirls out to its leaf, then hands over to the ring filling in behind it
  const su = scene.su[i];
  const ph = expoInOut(seg(t, 24.95 + n.r * 0.45, 26.15 + n.r * 0.45));
  if (ph > 0) {
    if (su !== undefined) {
      const sp0 = sunXY(su.f, SUN_LEAF, t);
      const fx = arc2(x, y, sp0.x, sp0.y, 0.22, ph);
      x = fx.x;
      y = fx.y;
      size = lerp(size, 9, ph);
      round = lerp(round, su.k === 2 ? 1 : 0, ph);
      col = mixc(col, kindCol(C, su.k), ph);
      const hv = expoInOut(seg(t, 26.9 + su.f * 0.5, 27.3 + su.f * 0.5)) * (1 - expoOut(seg(t, 29.0 + su.f * 0.3, 29.35 + su.f * 0.3)));
      size *= 1 - hv;
    } else size *= 1 - ph;
  }
  // 8. decisions: one dot per measured region; the boundary moves and the dots it passes change shape
  const de = scene.de[i];
  const pd = expoInOut(seg(t, 29.35 + n.r * 0.45, 30.55 + n.r * 0.45));
  if (pd > 0) {
    if (de !== undefined) {
      const fd0 = arc2(x, y, de.x, de.y, 0.18, pd);
      x = fd0.x;
      y = fd0.y;
      let kp = Math.min(1, Math.max(0, (de.s - boundaryAt(t, scene.boundary)) / 0.012 + 0.5));
      kp = kp * kp * (3 - 2 * kp);
      size = lerp(size, 8 * (1 + 0.7 * kp * (1 - kp) * 4), pd);
      round = lerp(round, 1 - kp, pd);
      col = mixc(col, mixc(C.acc, C.ink, kp), pd);
    } else size *= 1 - pd;
  }
  // 9. architecture: dependencies between groups, cell by cell
  const dc = scene.dc[i];
  const pa = expoInOut(seg(t, 34.0 + n.r * 0.45, 35.2 + n.r * 0.45));
  if (pa > 0) {
    if (dc !== undefined) {
      const fa0 = arc2(x, y, dc.x, dc.y, 0.15, pa);
      x = fa0.x;
      y = fa0.y;
      const cc = mixc(dc.k === 2 ? C.acc : C.ink, C.g, 0.8 * (1 - dc.w));
      const dim = dc.band ? 0 : crossA(t);
      size = lerp(size, scene.dsm.cell - 2, pa);
      round = lerp(round, 0, pa);
      col = mixc(col, mixc(cc, C.g, 0.7 * dim), pa);
    } else size *= 1 - pa;
  }
  // dissolve back into the flat graph
  const sd3 = T.out + n.d * 0.012 + n.q * 0.04 + (n.k > 0 ? n.k * 0.03 : 0);
  const sp = expoInOut(seg(t, sd3, sd3 + 0.5));
  if (sp > 0) {
    size = lerp(size, dot, sp);
    round = lerp(round, 1, sp);
  }
  const od = T.out + 0.4 + (1 - n.r) * 0.5;
  const p3 = expoInOut(seg(t, od, od + 0.95));
  if (p3 > 0) {
    const cx3 = (x + tx) / 2 - (ty - y) * (n.r - 0.5) * 0.5;
    const cy3 = (y + ty) / 2 - (x - tx) * (n.r - 0.5) * 0.5;
    x = quad(x, cx3, tx, p3);
    y = quad(y, cy3, ty, p3);
  }
  col = mixc(col, C.ink, seg(t, T.out + 0.3, T.out + 1.1));
  return { x: cam.S === 1 ? x : LCX + (x - cam.fx) * cam.S, y: cam.S === 1 ? y : LCY + (y - cam.fy) * cam.S, s: size * cam.S, round, col, a: alpha };
}

function edgeStyle(scene: FilmScene, e: FilmEdge, t: number): { a: number; acc: number } {
  const tangle = 0.26 * (1 - seg(t, 4.0, 5.6)) + 0.26 * seg(t, T.out + 0.8, T.out + 1.75);
  const settled = seg(t, 4.5, 5.8);
  let a = tangle;
  let acc = 0;
  if (e.type === 0) {
    const q = scene.nodes[e.a]!.q;
    const fd = T.keep + 0.3 + q * 0.3;
    a += (0.16 + 0.22 * bump(t, 8.7, 10.1)) * settled * (1 - seg(t, fd, fd + 1.3));
  } else if (e.type === 1) a += 0.07 * settled * (1 - seg(t, 12.4, 13.2));
  else if (e.type === 2) {
    a += 0.14 * settled * (1 - seg(t, 16.0, 16.3)) + 0.42 * seg(t, 16.0, 16.4) * (1 - seg(t, 18.3, 19.0));
    acc = seg(t, 15.9, 16.4);
  } else if (e.type === 3) a += 0.1 * settled * (1 - seg(t, 16.0, 16.6));
  else {
    const pulse = bump(t, 9.7, 11.3);
    a += (0.12 + 0.3 * pulse + 0.25 * seg(t, 15.6, 15.8)) * settled;
    acc = Math.max(pulse, seg(t, 15.5, 15.8));
  }
  acc *= 1 - seg(t, T.out, T.out + 0.5);
  return { a, acc };
}

function frameReveal(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: number, col: string, width: number, dash?: number[]): void {
  if (p <= 0) return;
  const per = 2 * (w + h);
  ctx.strokeStyle = col;
  ctx.lineWidth = width;
  ctx.setLineDash(dash ?? [per * p, per]);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.stroke();
  ctx.setLineDash([]);
}

function tile(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, round: number, fill: string): void {
  const h = s / 2;
  const rr = Math.min(h, round * h);
  ctx.fillStyle = fill;
  ctx.beginPath();
  if (rr >= h - 0.01) ctx.arc(x, y, h, 0, TAU);
  else if (rr < 0.2) ctx.rect(x - h, y - h, s, s);
  else if (typeof ctx.roundRect === "function") ctx.roundRect(x - h, y - h, s, s, rr);
  else ctx.rect(x - h, y - h, s, s);
  ctx.fill();
}

function cursor(ctx: CanvasRenderingContext2D, C: FilmColors, x: number, y: number, press: number): void {
  const k = 1 - 0.12 * press;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 27);
  ctx.lineTo(7, 20.5);
  ctx.lineTo(12, 31);
  ctx.lineTo(17, 28.6);
  ctx.lineTo(12.2, 18.6);
  ctx.lineTo(21, 18.6);
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = css(C.surf, 1);
  ctx.stroke();
  ctx.fillStyle = css(C.ink, 1);
  ctx.fill();
  ctx.restore();
}

function setFont(ctx: CanvasRenderingContext2D, fonts: FilmFonts, size: number, weight: number, mono: boolean, track: number): void {
  ctx.font = `${weight} ${size}px ${mono ? fonts.mono : fonts.sans}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${track}px`;
}

/** Hierarchy: rings sweep in from the centre outward; one module lifts as if picked, then the rings let go. */
function drawSun(ctx: CanvasRenderingContext2D, scene: FilmScene, C: FilmColors, t: number): void {
  const fade = 1 - seg(t, 29.1, 29.6);
  const fp = expoInOut(seg(t, 27.9, 28.3)) * (1 - expoInOut(seg(t, 28.7, 29.1)));
  const rot = sunRot(t);
  if (fade <= 0) return;
  ctx.strokeStyle = css(C.g, 1);
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "miter";
  for (const A of scene.arcs) {
    const rv = expoInOut(seg(t, 25.5 + 0.18 * A.d, 26.7 + 0.18 * A.d));
    if (rv <= A.a0) continue;
    const a1 = Math.min(A.a1, rv);
    const mid = (A.a0 + A.a1) / 2;
    const inF = A.d >= 2 && mid >= scene.foc.a0 && mid <= scene.foc.a1;
    const ri = SUN_R0 + (A.d - 1) * SUN_RING + (inF ? 14 * fp : 0);
    const ro = ri + SUN_RING - 3;
    const t0 = A.a0 * TAU - PI / 2 + rot;
    const t1 = a1 * TAU - PI / 2 + rot;
    ctx.globalAlpha = fade * (A.d >= 2 && !inF ? 1 - 0.6 * fp : 1);
    ctx.fillStyle = css(A.d === 1 ? mixc(C.g, C.ink, 0.2) : kindCol(C, A.k), 1);
    ctx.beginPath();
    ctx.arc(LCX, LCY, ro, t0, t1);
    ctx.arc(LCX, LCY, ri, t1, t0, true);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Decisions: the score axis and the boundary, which slides up and back. While it is off the recorded value it is labelled. */
function drawAxis(ctx: CanvasRenderingContext2D, scene: FilmScene, C: FilmColors, fonts: FilmFonts, t: number): void {
  const fade = 1 - seg(t, 33.9, 34.3);
  const ax = expoInOut(seg(t, 29.9, 30.6));
  const tk = seg(t, 30.3, 30.7);
  const bl = expoOut(seg(t, 30.6, 31.2));
  if (fade <= 0) return;
  ctx.globalAlpha = fade;
  ctx.strokeStyle = css(C.ls, 1);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(DEC_X0, DEC_Y);
  ctx.lineTo(lerp(DEC_X0, DEC_X1, ax), DEC_Y);
  for (let v = 0; v <= 10; v++) {
    const tx = DEC_X0 + (v / 10) * (DEC_X1 - DEC_X0);
    if (tx <= lerp(DEC_X0, DEC_X1, ax)) {
      ctx.moveTo(tx, DEC_Y);
      ctx.lineTo(tx, DEC_Y + (v % 5 ? 5 : 10));
    }
  }
  ctx.stroke();
  if (tk > 0) {
    ctx.globalAlpha = fade * tk;
    setFont(ctx, fonts, 14, 500, true, 1.4);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = css(C.acc, 1);
    ctx.beginPath();
    ctx.arc(DEC_X0 + 5, DEC_Y + 37, 5, 0, TAU);
    ctx.fill();
    ctx.fillText("REBUILT", DEC_X0 + 18, DEC_Y + 42);
    ctx.textAlign = "right";
    ctx.fillStyle = css(C.ink, 1);
    ctx.fillRect(DEC_X1 - 10, DEC_Y + 32, 10, 10);
    ctx.fillText("KEPT", DEC_X1 - 18, DEC_Y + 42);
  }
  if (bl > 0) {
    const b = boundaryAt(t, scene.boundary);
    const bx = DEC_X0 + b * (DEC_X1 - DEC_X0);
    const top = DEC_Y - 330 * bl;
    ctx.globalAlpha = fade;
    ctx.strokeStyle = css(C.acc, 1);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, DEC_Y + 12);
    ctx.lineTo(bx, top);
    ctx.stroke();
    ctx.globalAlpha = fade * seg(bl, 0.6, 1);
    setFont(ctx, fonts, 16, 500, true, 0);
    ctx.textAlign = "center";
    ctx.fillStyle = css(C.acc, 1);
    ctx.fillText(b.toFixed(2), bx, top - 14);
    // The line is a what-if, not the recorded decision, whenever it is off the recorded boundary.
    const off = seg(Math.abs(b - scene.boundary), 0.004, 0.03);
    if (off > 0) {
      ctx.globalAlpha = fade * seg(bl, 0.6, 1) * off;
      setFont(ctx, fonts, 13, 500, true, 1.2);
      ctx.fillStyle = css(C.fg3, 1);
      ctx.fillText("WHAT IF", bx, top - 36);
    }
  }
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
}

/** Architecture: a crosshair on one group's row and column, under the cells. */
function drawBands(ctx: CanvasRenderingContext2D, scene: FilmScene, C: FilmColors, t: number): void {
  const cr = crossA(t);
  if (cr <= 0) return;
  const cell = scene.dsm.cell;
  const p = scene.dsm.hb[0] * cell;
  const w = scene.dsm.hb[1] * cell;
  const S = 24 * U;
  ctx.fillStyle = css(C.acc, 0.09 * cr);
  ctx.fillRect(X(0), Y(0) + p, S, w);
  ctx.fillRect(X(0) + p, Y(0), w, p);
  ctx.fillRect(X(0) + p, Y(0) + p + w, w, S - p - w);
}

/** Architecture: the matrix frame and each group's block; kept solid, rebuilt dashed. */
function drawFrames(ctx: CanvasRenderingContext2D, scene: FilmScene, C: FilmColors, t: number): void {
  const fade = 1 - seg(t, 38.0, 38.4);
  if (fade <= 0) return;
  const cell = scene.dsm.cell;
  const DX0 = X(0);
  const DY0 = Y(0);
  ctx.globalAlpha = fade;
  frameReveal(ctx, DX0 - 4, DY0 - 4, 24 * U + 8, 24 * U + 8, expoOut(seg(t, 34.9, 35.7)), css(C.ls, 1), 1.25);
  scene.dsm.blocks.forEach((B, bi) => {
    const p = expoOut(seg(t, 35.2 + bi * 0.08, 35.9 + bi * 0.08));
    if (p <= 0) return;
    const x = DX0 + B[0] * cell - 1.5;
    const w = B[1] * cell + 3;
    if (B[2] === 2) {
      ctx.globalAlpha = fade * p;
      frameReveal(ctx, x, DY0 + B[0] * cell - 1.5, w, w, 1, css(C.acc, 1), 1.6, [6, 4]);
      ctx.globalAlpha = fade;
    } else frameReveal(ctx, x, DY0 + B[0] * cell - 1.5, w, w, p, css(C.fg2, 1), 1.6);
  });
  ctx.globalAlpha = 1;
}

/** Wraps `t` into the loop, so any time (a clock that has run on, a scrub past the end) is a frame of the film. */
export function wrapTime(t: number): number {
  return ((t % LOOP) + LOOP) % LOOP;
}

/**
 * Paints the frame at time `t` (seconds) onto `ctx`, a canvas `W` by `H` CSS pixels at `dpr` device pixels per CSS pixel.
 * The film is laid out on a 1600 by 1000 stage and `opts.core` says which part of it fills the canvas.
 */
export function drawFilm(
  ctx: CanvasRenderingContext2D,
  scene: FilmScene,
  time: number,
  W: number,
  H: number,
  dpr: number,
  C: FilmColors,
  fonts: FilmFonts,
  opts: FilmOptions = {},
): void {
  const t = wrapTime(time);
  const core = opts.core ?? DEFAULT_CORE;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = css(C.g, 1);
  ctx.fillRect(0, 0, W, H);
  const s = Math.min(W / core.w, H / core.h);
  const ox = W / 2 - core.cx * s;
  const oy = H / 2 - core.cy * s;
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
  const cam = camera(t);
  const P = (x: number, y: number): { x: number; y: number } => ({ x: LCX + (x - cam.fx) * cam.S, y: LCY + (y - cam.fy) * cam.S });
  const NN = scene.nodes.length;

  // construction grid: the mark's 24 units, shown while packages are measured
  const gA = seg(t, 4.4, 5.6) * (1 - seg(t, 12.6, 13.8));
  if (gA > 0) {
    ctx.strokeStyle = css(C.line, gA);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let u = 0; u <= 24; u++) {
      let a = P(X(u), Y(0));
      let b = P(X(u), Y(24));
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      a = P(X(0), Y(u));
      b = P(X(24), Y(u));
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  const st: NodeState[] = new Array<NodeState>(NN);
  for (let i = 0; i < NN; i++) st[i] = nodeState(scene, i, t, cam, C);

  // dependencies
  ctx.lineCap = "round";
  for (const E0 of scene.edges) {
    const es = edgeStyle(scene, E0, t);
    if (es.a < 0.004) continue;
    const A = st[E0.a]!;
    const B = st[E0.b]!;
    let ax = A.x;
    let ay = A.y;
    if (E0.type === 4) {
      const cut = expoIn(seg(t, 15.8 + E0.r * 0.5, 16.25 + E0.r * 0.5)) * (1 - seg(t, T.out, T.out + 0.01));
      ax = lerp(A.x, B.x, cut);
      ay = lerp(A.y, B.y, cut);
      if (cut >= 1) continue;
    }
    ctx.strokeStyle = css(mixc(C.ink, C.acc, es.acc), es.a);
    ctx.lineWidth = 1.25 + es.acc * 0.5;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  }

  // region frames
  for (let q = 0; q < 4; q++) {
    const Q = scene.quads[q]!;
    const fp = expoOut(seg(t, 4.9 + q * 0.12, 5.9 + q * 0.12));
    let fa = q < 3 ? 1 - seg(t, T.keep + 0.6 + q * 0.3, T.keep + 1.4 + q * 0.3) : 1 - seg(t, 18.6, 19.2);
    fa *= 1 - cam.z;
    if (fp <= 0 || fa <= 0) continue;
    const p0 = P(X(Q.x - 0.35), Y(Q.y - 0.35));
    const wq = 10.7 * U * cam.S;
    const rb = q === 3 ? seg(t, 15.6, 15.9) : 0;
    ctx.globalAlpha = fa;
    if (rb > 0) {
      ctx.lineDashOffset = -t * 18;
      frameReveal(ctx, p0.x, p0.y, wq, wq, 1, css(C.acc, 1), 1.6, [7, 6]);
      ctx.lineDashOffset = 0;
      if (rb < 1) frameReveal(ctx, p0.x, p0.y, wq, wq, 1, css(C.fg3, 1 - rb), 1.25);
    } else frameReveal(ctx, p0.x, p0.y, wq, wq, fp, css(C.fg3, 1), 1.25);
    ctx.globalAlpha = 1;
  }

  // the views drawn under their files
  if (t > 25.4 && t < 29.7) drawSun(ctx, scene, C, t);
  if (t > 29.8 && t < 34.4) drawAxis(ctx, scene, C, fonts, t);
  if (t > 36.3 && t < 37.9) drawBands(ctx, scene, C, t);

  // files
  for (let i = 0; i < NN; i++) {
    const S0 = st[i]!;
    if (S0.s < 0.4) continue;
    let base = S0.col;
    if (S0.a <= 0) {
      const fz = Math.min(1, -S0.a * 2.4);
      if (fz >= 0.97) continue;
      base = mixc(base, C.g, fz);
      ctx.globalAlpha = 1;
    } else {
      if (S0.a <= 0.01) continue;
      ctx.globalAlpha = S0.a;
    }
    tile(ctx, S0.x, S0.y, S0.s, S0.round, css(base, 1));
  }
  ctx.globalAlpha = 1;

  // zoom: the community's frame, its groups, a click that traces dependencies
  if (cam.z > 0.001) {
    const bp = P(X(BLOCKS[ZB]![0]), Y(BLOCKS[ZB]![1]));
    const bw = 4 * U * cam.S;
    const open = expoOut(seg(t, 21.0, 21.6)) * (1 - seg(t, 23.6, 24.0));
    if (open > 0) frameReveal(ctx, bp.x, bp.y, bw, bw, open, css(C.acc, 1), 1.6);
    scene.cards.forEach((cd, ci) => {
      const cf = expoOut(seg(t, 21.3 + ci * 0.08, 21.95 + ci * 0.08)) * (1 - seg(t, 23.45, 23.8));
      if (cf <= 0) return;
      const c0 = P(X(BLOCKS[ZB]![0] + cd.x), Y(BLOCKS[ZB]![1] + cd.y));
      frameReveal(ctx, c0.x, c0.y, cd.w * U * cam.S, cd.h * U * cam.S, cf, css(C.fg3, 1), 1.2);
      setFont(ctx, fonts, 15, 400, true, 0);
      ctx.fillStyle = css(C.fg3, cf);
      ctx.fillText(cd.id, c0.x + 12, c0.y + 24);
    });
    const hov = seg(t, 22.5, 22.7) * (1 - seg(t, 22.75, 22.8));
    const selp = seg(t, 22.78, 23.15) * (1 - seg(t, 23.3, 23.55));
    const sN = st[300 + ZB * 16 + SEL]!;
    RELATED.forEach((ri, idx) => {
      const rN = st[300 + ZB * 16 + ri]!;
      if (hov > 0) {
        ctx.strokeStyle = css(C.fg3, hov);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sN.x, sN.y);
        ctx.lineTo(rN.x, rN.y);
        ctx.stroke();
      }
      const gp = expoOut(seg(t, 22.8 + idx * 0.07, 23.2 + idx * 0.07)) * (1 - seg(t, 23.3, 23.55));
      if (gp > 0) {
        const ang = Math.atan2(rN.y - sN.y, rN.x - sN.x);
        const rad = rN.s * 0.75;
        const ex = lerp(sN.x, rN.x - Math.cos(ang) * rad, gp);
        const ey = lerp(sN.y, rN.y - Math.sin(ang) * rad, gp);
        ctx.strokeStyle = css(C.acc, 1);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(sN.x, sN.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        if (gp > 0.6) {
          ctx.fillStyle = css(C.acc, seg(gp, 0.6, 1));
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - Math.cos(ang - 0.45) * 13, ey - Math.sin(ang - 0.45) * 13);
          ctx.lineTo(ex - Math.cos(ang + 0.45) * 13, ey - Math.sin(ang + 0.45) * 13);
          ctx.closePath();
          ctx.fill();
        }
        ctx.strokeStyle = css(C.ink, gp);
        ctx.lineWidth = 2;
        const hs = rN.s / 2 + 5;
        ctx.strokeRect(rN.x - hs, rN.y - hs, hs * 2, hs * 2);
      }
    });
    if (selp > 0) {
      ctx.strokeStyle = css(C.acc, selp);
      ctx.lineWidth = 2.5;
      const hs2 = sN.s / 2 + 6;
      ctx.strokeRect(sN.x - hs2, sN.y - hs2, hs2 * 2, hs2 * 2);
    }
    // pointer
    const cin = expoInOut(seg(t, 21.85, 22.6));
    const cout = expoInOut(seg(t, 23.3, 23.95));
    if (cin > 0 && cout < 1) {
      const hx = sN.x + 4;
      const hy = sN.y + 6;
      const px = lerp(lerp(1500, hx, cin), 1560, cout);
      const py = lerp(lerp(940, hy, cin), 1010, cout);
      const press = bump(t, 22.68, 22.86);
      const ring = seg(t, 22.72, 23.2);
      if (ring > 0 && ring < 1) {
        ctx.strokeStyle = css(C.acc, 1 - ring);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx - 4, hy - 6, 8 + expoOut(ring) * 34, 0, TAU);
        ctx.stroke();
      }
      // tooltip
      const tip = expoOut(seg(t, 22.9, 23.15)) * (1 - seg(t, 23.3, 23.5));
      if (tip > 0) {
        setFont(ctx, fonts, 17, 500, true, 0);
        const tw = ctx.measureText(scene.selName).width + 24;
        const tx0 = sN.x - tw / 2;
        const ty0 = sN.y - sN.s / 2 - 54 + (1 - tip) * 8;
        ctx.globalAlpha = tip;
        ctx.fillStyle = css(C.surf, 1);
        ctx.strokeStyle = css(C.ls, 1);
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(tx0, ty0, tw, 34, 4);
        else ctx.rect(tx0, ty0, tw, 34);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = css(C.ink, 1);
        ctx.fillText(scene.selName, tx0 + 12, ty0 + 23);
        ctx.globalAlpha = 1;
      }
      cursor(ctx, C, px, py, press);
    }
  }

  // region names, scores and decisions
  for (let q = 0; q < 4; q++) {
    const Q = scene.quads[q]!;
    const la = seg(t, 5.3 + q * 0.12, 5.9 + q * 0.12) * (1 - seg(t, 19.3, 19.8)) * (1 - cam.z);
    if (la <= 0) continue;
    const x0 = X(Q.x);
    const x1 = X(Q.x + 10);
    const ty = Q.side < 0 ? Y(Q.y) - 0.62 * U : Y(Q.y + 10) + 0.62 * U;
    const ly = Q.side < 0 ? ty - 13 : ty + 26;
    const dy2 = Q.side < 0 ? ly - 24 : ly + 24;
    ctx.globalAlpha = la;
    ctx.textAlign = "left";
    setFont(ctx, fonts, 15, 400, true, 0);
    ctx.fillStyle = css(C.fg2, 1);
    ctx.fillText(Q.name, x0, ly);
    const tr = expoOut(seg(t, 8.0 + q * 0.12, 8.7 + q * 0.12));
    if (tr > 0) {
      ctx.strokeStyle = css(C.ls, 1);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, ty);
      ctx.lineTo(lerp(x0, x1, tr), ty);
      ctx.stroke();
      const mxp = (x0 + x1) / 2;
      ctx.strokeStyle = css(C.ink, tr);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mxp, ty - 7);
      ctx.lineTo(mxp, ty + 7);
      ctx.stroke();
      const fv = Q.score * expoOut(seg(t, 8.6 + q * 0.3, 10.5 + q * 0.3));
      if (fv > 0) {
        ctx.strokeStyle = css(C.acc, 1);
        ctx.lineWidth = 3.5;
        ctx.lineCap = "butt";
        ctx.beginPath();
        ctx.moveTo(x0, ty);
        ctx.lineTo(x0 + (x1 - x0) * fv, ty);
        ctx.stroke();
        ctx.lineCap = "round";
      }
      ctx.textAlign = "right";
      setFont(ctx, fonts, 15, 500, true, 0);
      ctx.fillStyle = css(C.ink, 1);
      ctx.fillText(fv.toFixed(3), x1, ly);
      ctx.textAlign = "left";
      const dw = q < 3 ? seg(t, T.keep + 0.25 + q * 0.3, T.keep + 0.65 + q * 0.3) : seg(t, 15.7, 16.1);
      if (dw > 0) {
        const dyy = dy2 + (1 - expoOut(dw)) * 8 * (Q.side < 0 ? 1 : -1);
        const sq = 9;
        ctx.globalAlpha = la * dw;
        ctx.fillStyle = css(q < 3 ? C.ink : C.acc, 1);
        ctx.fillRect(x0, dyy - sq, sq, sq);
        setFont(ctx, fonts, 13, 500, true, 1.2);
        ctx.fillStyle = css(q < 3 ? C.ink : C.acc, 1);
        ctx.fillText(q < 3 ? "KEPT" : "REBUILT", x0 + sq + 8, dyy);
      }
    }
    ctx.globalAlpha = 1;
  }

  if (t > 34.8 && t < 38.5) drawFrames(ctx, scene, C, t);
}
