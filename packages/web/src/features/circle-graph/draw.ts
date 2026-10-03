/**
 * Canvas drawing for the circle graph. Browser code; the geometry it reads is
 * the pure `CircleModel`.
 *
 * One recursive pass from the root: a circle is drawn when it is on screen and
 * at least a pixel or so wide, and it opens (fades its children in) as it grows
 * past `OPEN_START_PX`. No edges are drawn until something is selected. Then the
 * selection's dependencies and dependents appear, each far end lifted to the
 * circle that is visible for it at the current zoom, so the same selection reads
 * as group-to-group links when zoomed out and file-to-file links when zoomed in.
 */

import { type Camera, type Viewport, type ZoomPalette, bandForScore } from "@/features/structure-map/canvas";
import { type CircleModel, type CircleNode, type SelectionLinks, circlePath, isWithin } from "./model";

export const OPEN_START_PX = 70;
export const OPEN_END_PX = 150;
/** A circle counts as open (its children are the visible link ends) past this size. */
const OPEN_MID_PX = (OPEN_START_PX + OPEN_END_PX) / 2;
/** The focus is the deepest circle under the viewport centre at least this share of the short axis. */
const FOCUS_SHARE = 0.22;
const MIN_DRAW_PX = 1.2;
const CULL_MARGIN_PX = 48;
/** Most links drawn for one selection; the strongest win. */
const MAX_LINKS = 120;
const FONT = "ui-sans-serif, system-ui, sans-serif";

export interface Hit {
  id: string;
  sx: number;
  sy: number;
  r: number;
}

export interface DrawState {
  hoveredId: string | null;
  selectedId: string | null;
  selectionLinks: SelectionLinks | null;
  /** Skip labels for a frame or two while panning. */
  lowDetail: boolean;
}

/** Link counts between the selection and one visible circle. */
export interface EndpointCounts {
  out: number;
  in: number;
}

export interface DrawResult {
  hits: Hit[];
  /** Root-first ids of the circles the camera is inside. */
  focusPath: string[];
  /** Visible link ends for the selection this frame, by circle id. */
  endpoints: Map<string, EndpointCounts>;
}

interface Screen {
  sx: number;
  sy: number;
  rs: number;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function toScreen(cam: Camera, vp: Viewport, n: CircleNode): Screen {
  return {
    sx: vp.w / 2 + (n.x - cam.cx) * cam.scale,
    sy: vp.h / 2 + (n.y - cam.cy) * cam.scale,
    rs: n.r * cam.scale,
  };
}

/** Root-first circles that hold the viewport centre and are big enough to be "where you are". */
export function focusPath(model: CircleModel, cam: Camera, vp: Viewport): string[] {
  const root = model.nodes.get(model.rootId);
  if (!root) return [];
  const minR = (Math.min(vp.w, vp.h) * FOCUS_SHARE) / 2;
  const path = [root.id];
  let cur = root;
  for (;;) {
    let next: CircleNode | null = null;
    for (const id of cur.children) {
      const c = model.nodes.get(id)!;
      if (c.r * cam.scale < minR) continue;
      if (Math.hypot(cam.cx - c.x, cam.cy - c.y) <= c.r) {
        next = c;
        break;
      }
    }
    if (!next) return path;
    path.push(next.id);
    cur = next;
  }
}

/** The circle that stands for `id` at this zoom: its deepest ancestor whose parents are all open. */
function visibleEnd(model: CircleModel, id: string, scale: number, paths: Map<string, CircleNode[]>): CircleNode | null {
  let path = paths.get(id);
  if (!path) paths.set(id, (path = circlePath(model, id)));
  for (let k = 0; k < path.length; k++) {
    const n = path[k]!;
    if (k === path.length - 1 || n.r * scale < OPEN_MID_PX) return k === 0 ? null : n;
  }
  return null;
}

function resolveEndpoints(
  model: CircleModel,
  cam: Camera,
  state: DrawState,
  paths: Map<string, CircleNode[]>,
): { source: CircleNode; ends: Map<string, EndpointCounts> } | null {
  if (!state.selectedId || !state.selectionLinks) return null;
  const source = visibleEnd(model, state.selectedId, cam.scale, paths);
  if (!source) return null;
  const ends = new Map<string, EndpointCounts>();
  const add = (id: string, count: number, dir: "out" | "in") => {
    const end = visibleEnd(model, id, cam.scale, paths);
    if (!end || end.id === source.id || isWithin(model, source.id, end.id)) return;
    let e = ends.get(end.id);
    if (!e) ends.set(end.id, (e = { out: 0, in: 0 }));
    e[dir] += count;
  };
  for (const [id, count] of state.selectionLinks.out) add(id, count, "out");
  for (const [id, count] of state.selectionLinks.in) add(id, count, "in");
  return { source, ends };
}

export function drawCircles(
  ctx: CanvasRenderingContext2D,
  model: CircleModel,
  cam: Camera,
  vp: Viewport,
  palette: ZoomPalette,
  state: DrawState,
  paths: Map<string, CircleNode[]>,
): DrawResult {
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, vp.w, vp.h);

  const hits: Hit[] = [];
  const path = focusPath(model, cam, vp);
  const focusId = path[path.length - 1] ?? model.rootId;
  const sel = resolveEndpoints(model, cam, state, paths);

  const drawNode = (n: CircleNode, alpha: number, parent: Screen | null) => {
    const s = toScreen(cam, vp, n);
    if (s.rs < MIN_DRAW_PX) return;
    if (
      s.sx + s.rs < -CULL_MARGIN_PX ||
      s.sx - s.rs > vp.w + CULL_MARGIN_PX ||
      s.sy + s.rs < -CULL_MARGIN_PX ||
      s.sy - s.rs > vp.h + CULL_MARGIN_PX
    ) {
      return;
    }
    const openT = n.children.length > 0 ? smooth(OPEN_START_PX, OPEN_END_PX, s.rs) : 0;
    // With a selection, circles that are neither it, inside it, nor one of its link ends step back.
    const dim =
      sel !== null && openT < 0.5 && !sel.ends.has(n.id) && !isWithin(model, n.id, sel.source.id) ? 0.35 : 1;
    drawDisc(ctx, n, s, alpha * dim, openT, palette, state);
    hits.push({ id: n.id, sx: s.sx, sy: s.sy, r: s.rs });

    if (openT > 0.01) for (const id of n.children) drawNode(model.nodes.get(id)!, alpha * openT, s);
    if (!state.lowDetail) drawLabel(ctx, n, s, parent, alpha * dim, openT, n.id === focusId, palette);
  };
  drawNode(model.nodes.get(model.rootId)!, 1, null);

  if (sel) drawLinks(ctx, sel.source, sel.ends, model, cam, vp, palette);
  return { hits, focusPath: path, endpoints: sel?.ends ?? new Map() };
}

function strokeFor(n: CircleNode, palette: ZoomPalette): string {
  const z = n.node;
  if (z.decision === "preserve") return palette.decisionPreserve;
  if (z.decision === "reconstruct") return palette.decisionReconstruct;
  if (z.kind === "file" && z.health_score !== null) {
    const band = bandForScore(z.health_score);
    return band === "alert" ? palette.healthAlert : band === "warning" ? palette.healthWarning : palette.healthHealthy;
  }
  return palette.nodeBorder;
}

function drawDisc(
  ctx: CanvasRenderingContext2D,
  n: CircleNode,
  s: Screen,
  alpha: number,
  openT: number,
  palette: ZoomPalette,
  state: DrawState,
): void {
  const { sx, sy, rs } = s;

  ctx.save();
  ctx.globalAlpha = alpha * (1 - 0.7 * openT);
  if (rs > 6 && openT < 0.9) {
    ctx.shadowColor = palette.shadow;
    ctx.shadowBlur = Math.min(14, rs * 0.3);
    ctx.shadowOffsetY = Math.min(4, rs * 0.08);
  }
  ctx.beginPath();
  ctx.arc(sx, sy, rs, 0, Math.PI * 2);
  ctx.fillStyle = n.node.kind === "file" ? palette.nodeFill : palette.nodeFillAlt;
  ctx.fill();
  ctx.restore();

  const selected = state.selectedId === n.id;
  const hovered = state.hoveredId === n.id;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(sx, sy, rs, 0, Math.PI * 2);
  ctx.strokeStyle = selected || hovered ? palette.accent : strokeFor(n, palette);
  ctx.lineWidth = selected ? 3 : hovered ? 2.25 : n.node.decision || n.node.health_score !== null ? 1.75 : 1;
  ctx.stroke();
  ctx.restore();
}

function drawLinks(
  ctx: CanvasRenderingContext2D,
  source: CircleNode,
  ends: Map<string, EndpointCounts>,
  model: CircleModel,
  cam: Camera,
  vp: Viewport,
  palette: ZoomPalette,
): void {
  const src = toScreen(cam, vp, source);
  const ranked = [...ends].sort((a, b) => b[1].out + b[1].in - (a[1].out + a[1].in) || (a[0] < b[0] ? -1 : 1));
  const shown = ranked.slice(0, MAX_LINKS);

  // Lines first, then the end rings on top, so every end stays readable.
  for (const [id, counts] of shown) {
    const end = toScreen(cam, vp, model.nodes.get(id)!);
    if (counts.out > 0) strokeLink(ctx, src, end, counts.out, palette.accent, 1);
    if (counts.in > 0) strokeLink(ctx, end, src, counts.in, palette.flow, -1);
  }
  for (const [id, counts] of shown) {
    const end = toScreen(cam, vp, model.nodes.get(id)!);
    ctx.save();
    ctx.beginPath();
    ctx.arc(end.sx, end.sy, end.rs, 0, Math.PI * 2);
    ctx.strokeStyle = counts.out >= counts.in ? palette.accent : palette.flow;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(src.sx, src.sy, src.rs, 0, Math.PI * 2);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  if (ranked.length > shown.length) {
    ctx.save();
    ctx.font = `400 11px ${FONT}`;
    ctx.fillStyle = palette.textMuted;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`Showing the ${shown.length} strongest of ${ranked.length} links`, 12, vp.h - 10);
    ctx.restore();
  }
}

/**
 * A gently bowed line from circle edge to circle edge with an arrowhead at
 * `to`. `side` bends dependencies and dependents opposite ways, so a pair that
 * runs both ways shows as two lines rather than one.
 */
function strokeLink(
  ctx: CanvasRenderingContext2D,
  from: Screen,
  to: Screen,
  count: number,
  color: string,
  side: 1 | -1,
): void {
  const dx = to.sx - from.sx;
  const dy = to.sy - from.sy;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bow = Math.min(60, len * 0.12) * side;
  const cx = (from.sx + to.sx) / 2 + nx * bow;
  const cy = (from.sy + to.sy) / 2 + ny * bow;
  const start = towards(from, cx, cy, from.rs + 1);
  const end = towards(to, cx, cy, to.rs + 2);

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.min(5, 1 + Math.log2(1 + count) * 0.6);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(cx, cy, end.x, end.y);
  ctx.stroke();
  const ang = Math.atan2(end.y - cy, end.x - cx);
  const size = 7;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - size * Math.cos(ang - 0.42), end.y - size * Math.sin(ang - 0.42));
  ctx.lineTo(end.x - size * Math.cos(ang + 0.42), end.y - size * Math.sin(ang + 0.42));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function towards(from: Screen, x: number, y: number, dist: number): { x: number; y: number } {
  const dx = x - from.sx;
  const dy = y - from.sy;
  const len = Math.hypot(dx, dy) || 1;
  return { x: from.sx + (dx / len) * dist, y: from.sy + (dy / len) * dist };
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  n: CircleNode,
  s: Screen,
  parent: Screen | null,
  alpha: number,
  openT: number,
  isFocus: boolean,
  palette: ZoomPalette,
): void {
  const closedA = alpha * (1 - openT);
  const openA = alpha * openT;

  if (closedA > 0.02) {
    if (s.rs >= 18) {
      // Inside the disc.
      const size = Math.round(Math.min(15, Math.max(9, s.rs * 0.28)));
      ctx.save();
      ctx.globalAlpha = closedA;
      ctx.font = `600 ${size}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = palette.nodeText;
      const showCount = s.rs >= 36 && n.node.kind !== "file";
      ctx.fillText(fitText(ctx, n.node.name, s.rs * 1.7), s.sx, showCount ? s.sy - size * 0.45 : s.sy);
      if (showCount) {
        ctx.font = `400 ${size - 2}px ${FONT}`;
        ctx.fillStyle = palette.textMuted;
        const files = n.node.metrics.file_count;
        ctx.fillText(`${files} file${files === 1 ? "" : "s"}`, s.sx, s.sy + size * 0.75);
      }
      ctx.restore();
    } else if (s.rs >= 6 && parent && parent.rs >= 260) {
      // Under a small disc.
      ctx.save();
      ctx.globalAlpha = closedA * 0.8;
      ctx.font = `500 10px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = palette.nodeText;
      ctx.fillText(fitText(ctx, n.node.name, 110), s.sx, s.sy + s.rs + 3);
      ctx.restore();
    }
  }

  // An open circle is named just above its rim; the circle you are in shows its full path.
  if (openA > 0.02 && s.sy - s.rs - 6 > 12) {
    const size = isFocus ? 14 : Math.round(Math.min(14, Math.max(11, s.rs * 0.06)));
    ctx.save();
    ctx.globalAlpha = openA;
    ctx.font = `600 ${size}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = palette.nodeText;
    ctx.fillText(fitText(ctx, isFocus ? n.label : n.node.name, s.rs * 1.8), s.sx, s.sy - s.rs - 6);
    ctx.restore();
  }
}

/** Ellipsize `text` to fit `maxW` pixels in the current font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0) return "";
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "" : `${text.slice(0, lo)}…`;
}

/** The deepest circle under a screen point. */
export function pickHit(hits: Hit[], sx: number, sy: number): string | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]!;
    if (Math.hypot(sx - h.sx, sy - h.sy) <= h.r) return h.id;
  }
  return null;
}
