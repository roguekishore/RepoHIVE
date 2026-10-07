/**
 * Draws the Map. A card is a rectangle in root space; how it looks depends on how big it is on screen. Small, it is a
 * card face (name, kind, file count). As it grows past a threshold its face fades out and its children fade in inside
 * it, one level at a time: zooming in opens a card, zooming out closes it. Hovering a card traces its relations to its
 * siblings; a pinned (selected) card does the same in the accent colour and dims everything it is not related to.
 *
 * Kept and rebuilt differ by shape as well as colour: a small solid square for kept, a dashed square and a dashed
 * outline in the rebuilt colour for rebuilt, nothing for a card with no recorded decision.
 */
import type { Camera, Rect, Size } from "../../canvas/camera";
import { worldToScreen } from "../../canvas/camera";
import { rgbaCss } from "../../canvas/colors";
import type { DrawFrame } from "../../canvas/controller";
import { fitText } from "../../canvas/text";
import type { ColorToken } from "../../tokens/names";
import type { MapKind, MapModel, MapNode } from "./model";

/** Token values the canvas needs beyond colours and type sizes; read once by the screen. */
export interface MapLengths {
  readonly radius: number;
  readonly hairline: number;
  readonly emphasis: number;
  readonly stroke: number;
}

export interface MapDrawState {
  readonly selected: number;
  readonly hovered: number;
  /** Siblings linked to the selected card. */
  readonly related: ReadonlySet<number>;
  /** The selected card's parent, grandparent and so on. */
  readonly ancestors: ReadonlySet<number>;
  readonly lengths: MapLengths;
}

const DIMMED = 0.25;

interface Thresholds {
  readonly start: number;
  readonly end: number;
}

/** The on-screen width at which a card starts to open, and at which it is fully open, scaled to the viewport. */
export function thresholds(size: Size): Thresholds {
  const start = Math.min(420, Math.max(96, size.w * 0.22));
  const end = Math.min(620, Math.max(200, size.w * 0.38));
  return { start, end: Math.max(end, start + 1) };
}

/** 0 for a card face, 1 for fully open, and in between while it crossfades. A card with no children never opens. */
export function openness(width: number, th: Thresholds, hasKids: boolean): number {
  if (!hasKids) return 0;
  return Math.min(1, Math.max(0, (width - th.start) / (th.end - th.start)));
}

const number = new Intl.NumberFormat("en-US");

function metricOf(node: MapNode): string {
  if (node.kind === "file") {
    const dot = node.name.lastIndexOf(".");
    return dot > 0 ? node.name.slice(dot + 1).toUpperCase() : "";
  }
  return node.files > 0 ? `${number.format(node.files)} ${node.files === 1 ? "file" : "files"}` : "";
}

export const KIND_LABEL: Readonly<Record<MapKind, string>> = {
  system: "Repository",
  layer: "Layer",
  group: "Group",
  folder: "Folder",
  file: "File",
};

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(r.x, r.y, r.w, r.h, rad);
  else ctx.rect(r.x, r.y, r.w, r.h);
}

/** A small icon for the card's kind, drawn as strokes inside a square of side `s` whose corner is (x, y). */
function drawKindIcon(ctx: CanvasRenderingContext2D, kind: MapKind, x: number, y: number, s: number): void {
  const move = (fx: number, fy: number): void => ctx.moveTo(x + fx * s, y + fy * s);
  const line = (fx: number, fy: number): void => ctx.lineTo(x + fx * s, y + fy * s);
  ctx.beginPath();
  switch (kind) {
    case "system":
      for (const [fx, fy] of [[0.1, 0.1], [0.56, 0.1], [0.1, 0.56], [0.56, 0.56]] as const) ctx.rect(x + fx * s, y + fy * s, 0.34 * s, 0.34 * s);
      break;
    case "layer":
      move(0.5, 0.1);
      line(0.9, 0.32);
      line(0.5, 0.54);
      line(0.1, 0.32);
      ctx.closePath();
      move(0.1, 0.56);
      line(0.5, 0.78);
      line(0.9, 0.56);
      break;
    case "group":
      ctx.rect(x + 0.34 * s, y + 0.12 * s, 0.5 * s, 0.5 * s);
      ctx.rect(x + 0.12 * s, y + 0.38 * s, 0.5 * s, 0.5 * s);
      break;
    case "folder":
      move(0.1, 0.24);
      line(0.4, 0.24);
      line(0.5, 0.4);
      line(0.9, 0.4);
      line(0.9, 0.84);
      line(0.1, 0.84);
      ctx.closePath();
      break;
    default:
      move(0.22, 0.06);
      line(0.62, 0.06);
      line(0.8, 0.26);
      line(0.8, 0.94);
      line(0.22, 0.94);
      ctx.closePath();
      move(0.62, 0.06);
      line(0.62, 0.26);
      line(0.8, 0.26);
  }
  ctx.stroke();
}

type Anchor = "l" | "r" | "t" | "b";

function sideOf(a: Rect, b: Rect): Anchor {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const nx = dx / ((a.w + b.w) / 2 || 1);
  const ny = dy / ((a.h + b.h) / 2 || 1);
  return Math.abs(nx) >= Math.abs(ny) ? (dx >= 0 ? "r" : "l") : dy >= 0 ? "b" : "t";
}

const NORMAL: Readonly<Record<Anchor, readonly [number, number]>> = { r: [1, 0], l: [-1, 0], b: [0, 1], t: [0, -1] };

function anchorPoint(r: Rect, side: Anchor, offset: number): { x: number; y: number } {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  if (side === "r") return { x: r.x + r.w, y: cy + offset * r.h };
  if (side === "l") return { x: r.x, y: cy + offset * r.h };
  if (side === "b") return { x: cx + offset * r.w, y: r.y + r.h };
  return { x: cx + offset * r.w, y: r.y };
}

const COUPLING_WEIGHT: Readonly<Record<string, number>> = { tight: 1.7, moderate: 1.3, loose: 1 };

export function drawMap(frame: DrawFrame<number>, model: MapModel, state: MapDrawState): void {
  const { ctx, palette, text, hits } = frame;
  const size: Size = { w: frame.width, h: frame.height };
  const th = thresholds(size);
  const colour = (token: ColorToken, alpha = 1): string => rgbaCss(palette.colors[token], alpha);
  const { lengths } = state;

  const screenRect = (index: number): Rect => frame.toScreen(model.rects[index] ?? { x: 0, y: 0, w: 0, h: 0 });

  const drawGrid = (): void => {
    const step = text.body * 2;
    const baseX = size.w / 2 - frame.camera.cx * frame.camera.scale;
    const baseY = size.h / 2 - frame.camera.cy * frame.camera.scale;
    const ox = ((baseX % step) + step) % step;
    const oy = ((baseY % step) + step) % step;
    const firstX = Math.round((ox - baseX) / step);
    const firstY = Math.round((oy - baseY) / step);
    const major = (k: number): boolean => ((k % 4) + 4) % 4 === 0;
    for (const heavy of [false, true]) {
      ctx.beginPath();
      for (let x = ox, k = firstX; x < size.w; x += step, k++) {
        if (major(k) !== heavy) continue;
        const px = Math.round(x) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, size.h);
      }
      for (let y = oy, k = firstY; y < size.h; y += step, k++) {
        if (major(k) !== heavy) continue;
        const py = Math.round(y) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(size.w, py);
      }
      ctx.globalAlpha = heavy ? 0.9 : 0.45;
      ctx.strokeStyle = colour("line");
      ctx.lineWidth = lengths.hairline;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  const drawCard = (node: MapNode, r: Rect, alpha: number, t: number): void => {
    if (alpha <= 0.01) return;
    const picked = node.i === state.selected;
    const hovered = node.i === state.hovered;
    const related = state.related.has(node.i);
    const rebuilt = node.decision === "rebuilt";
    ctx.globalAlpha = alpha;
    roundRect(ctx, r, lengths.radius);
    ctx.fillStyle = colour("surface");
    ctx.fill();
    if (node.decision !== null) {
      ctx.globalAlpha = alpha * 0.06;
      ctx.fillStyle = colour(rebuilt ? "rebuilt" : "fg-2");
      ctx.fill();
      ctx.globalAlpha = alpha;
    }
    ctx.setLineDash(rebuilt ? [lengths.hairline * 5, lengths.hairline * 3] : []);
    ctx.lineWidth = picked ? lengths.emphasis : related || hovered ? lengths.stroke : lengths.hairline;
    ctx.strokeStyle = colour(
      picked ? "accent" : related ? "fg" : hovered ? "fg-2" : rebuilt ? "rebuilt" : node.decision === "kept" ? "fg-3" : "line-strong",
    );
    roundRect(ctx, r, lengths.radius);
    ctx.stroke();
    ctx.setLineDash([]);

    const badge = text.label - 1;
    const showBadge = node.decision !== null && r.w >= 60 && r.h >= 28;
    if (showBadge) {
      const bx = r.x + r.w - badge - 9;
      const by = r.y + 9;
      ctx.lineWidth = lengths.stroke;
      ctx.strokeStyle = colour(rebuilt ? "rebuilt" : "fg-2");
      ctx.setLineDash(rebuilt ? [lengths.hairline * 2.5, lengths.hairline * 1.5] : []);
      ctx.strokeRect(bx + 0.5, by + 0.5, badge, badge);
      ctx.setLineDash([]);
    }

    const textAlpha = alpha * Math.max(0, 1 - 2 * t);
    if (r.w < 44 || r.h < 18 || textAlpha <= 0.02) {
      ctx.globalAlpha = 1;
      return;
    }
    const pad = Math.min(text.body - 2, Math.max(text.caption / 2, r.w * 0.06));
    const fs = r.w >= 160 && r.h >= 64 ? text.lead : r.w >= 96 ? text.body : text.caption;
    ctx.globalAlpha = textAlpha;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.font = `600 ${fs}px ${palette.sans}`;
    let tx = r.x + pad;
    if (r.w >= 52 && r.h >= 28) {
      ctx.save();
      ctx.globalAlpha = textAlpha * 0.8;
      ctx.strokeStyle = colour(picked ? "accent" : "fg-2");
      ctx.lineWidth = lengths.hairline * 1.25;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      drawKindIcon(ctx, node.kind, r.x + pad, r.y + pad + 1, fs - 2);
      ctx.restore();
      tx += fs + 6;
    }
    ctx.fillStyle = colour(picked ? "accent" : "fg");
    ctx.fillText(fitText(ctx, node.name, r.x + r.w - pad - tx - (showBadge ? badge + 8 : 0)), tx, r.y + pad + 1);
    if (r.w >= 132 && r.h >= 96) {
      const baseline = r.y + r.h - pad;
      ctx.font = `400 ${text.label}px ${palette.mono}`;
      ctx.textBaseline = "bottom";
      ctx.fillStyle = colour("fg-3");
      ctx.fillText(KIND_LABEL[node.kind].toUpperCase(), r.x + pad, baseline);
      const metric = metricOf(node);
      if (metric !== "") {
        ctx.textAlign = "right";
        ctx.fillStyle = colour("fg-2");
        ctx.fillText(fitText(ctx, metric, r.w * 0.5), r.x + r.w - pad, baseline);
      }
    }
    ctx.globalAlpha = 1;
  };

  const drawEdges = (parent: MapNode, alpha: number): void => {
    const relations = model.relations.get(parent.i);
    if (relations === undefined) return;
    const focus: Array<{ id: number; pinned: boolean }> = [];
    if (state.selected >= 0 && model.nodes[state.selected]?.parent === parent.i) focus.push({ id: state.selected, pinned: true });
    if (state.hovered >= 0 && state.hovered !== state.selected && model.nodes[state.hovered]?.parent === parent.i) {
      focus.push({ id: state.hovered, pinned: false });
    }
    if (focus.length === 0) return;

    interface Edge {
      s: number;
      t: number;
      count: number;
      coupling: string;
      pinned: boolean;
      a: Rect;
      b: Rect;
      sideA: Anchor;
      sideB: Anchor;
      offA: number;
      offB: number;
    }
    const edges: Edge[] = [];
    const seen = new Set<string>();
    for (const f of focus) {
      let taken = 0;
      // The relations come strongest first, so the cap keeps the strongest.
      for (const relation of relations) {
        if (relation.source !== f.id && relation.target !== f.id) continue;
        if (taken >= (f.pinned ? 16 : 10)) break;
        const key = `${relation.source}>${relation.target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = screenRect(relation.source);
        const b = screenRect(relation.target);
        if (a.w < 14 || b.w < 14) continue;
        taken++;
        edges.push({ s: relation.source, t: relation.target, count: relation.count, coupling: relation.coupling, pinned: f.pinned, a, b, sideA: sideOf(a, b), sideB: sideOf(b, a), offA: 0, offB: 0 });
      }
    }

    // Spread the lines that meet one side of a card so they do not land on the same point.
    const slots = new Map<string, Array<{ edge: Edge; end: "a" | "b"; other: Rect }>>();
    for (const edge of edges) {
      const ka = `${edge.s}${edge.sideA}`;
      const kb = `${edge.t}${edge.sideB}`;
      slots.set(ka, [...(slots.get(ka) ?? []), { edge, end: "a", other: edge.b }]);
      slots.set(kb, [...(slots.get(kb) ?? []), { edge, end: "b", other: edge.a }]);
    }
    for (const [key, group] of slots) {
      const horizontal = key.endsWith("t") || key.endsWith("b");
      group.sort((p, q) => (horizontal ? p.other.x + p.other.w / 2 - (q.other.x + q.other.w / 2) : p.other.y + p.other.h / 2 - (q.other.y + q.other.h / 2)));
      const n = Math.min(group.length, 6);
      const gap = n > 1 ? Math.min(0.26, 0.7 / (n - 1)) : 0;
      group.forEach((slot, j) => {
        const offset = (Math.min(j, 5) - (n - 1) / 2) * gap;
        if (slot.end === "a") slot.edge.offA = offset;
        else slot.edge.offB = offset;
      });
    }

    edges.sort((x, y) => Number(x.pinned) - Number(y.pinned));
    for (const e of edges) {
      const from = anchorPoint(e.a, e.sideA, e.offA);
      const to = anchorPoint(e.b, e.sideB, e.offB);
      const reach = Math.min(Math.hypot(to.x - from.x, to.y - from.y) * 0.55, Math.max(size.w, size.h) * 0.2);
      const n1 = NORMAL[e.sideA];
      const n2 = NORMAL[e.sideB];
      const c1 = { x: from.x + n1[0] * reach, y: from.y + n1[1] * reach };
      const c2 = { x: to.x + n2[0] * reach, y: to.y + n2[1] * reach };
      const arrow = e.pinned || (e.b.w >= 96 && e.b.h >= 64);
      const angle = Math.atan2(to.y - c2.y, to.x - c2.x);
      const head = arrow ? text.label - 4 : 0;
      ctx.globalAlpha = e.pinned ? Math.max(alpha, 0.95) : alpha * 0.95;
      ctx.strokeStyle = colour(e.pinned ? "accent" : "fg-3");
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = lengths.hairline * 1.25 * (COUPLING_WEIGHT[e.coupling] ?? 1) * (e.pinned ? 1.6 : 1);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x - Math.cos(angle) * head, to.y - Math.sin(angle) * head);
      ctx.stroke();
      if (arrow) {
        ctx.save();
        ctx.translate(to.x, to.y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-head, -head / 2);
        ctx.lineTo(-head, head / 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  };

  const drawNode = (node: MapNode, alpha: number, depth: number, lit: boolean, dimmedAbove: boolean): void => {
    const own = screenRect(node.i);
    if (own.x > size.w + 64 || own.y > size.h + 64 || own.x + own.w < -64 || own.y + own.h < -64 || own.w < 2 || own.h < 2) return;
    const hasKids = node.kids.length > 0;
    const t = openness(own.w, th, hasKids);
    const isLit = lit || node.i === state.selected || state.related.has(node.i);
    const dimmed = state.selected >= 0 && !dimmedAbove && !isLit && !state.ancestors.has(node.i);
    const factor = dimmed ? DIMMED : 1;
    const faceAlpha = alpha * (1 - t) * factor;
    const childAlpha = alpha * t * factor;
    let card = own;
    if (!hasKids && own.w > th.end) {
      // A file bigger than the open threshold stays card-sized, centred in its space.
      const k = th.end / own.w;
      card = { x: own.x + (own.w - own.w * k) / 2, y: own.y + (own.h - own.h * k) / 2, w: own.w * k, h: own.h * k };
    }
    if (faceAlpha > 0.01) drawCard(node, card, faceAlpha, t);
    if (alpha * (1 - t) > 0.3) hits.addRect(card.x, card.y, card.w, card.h, node.i, depth);
    if (!hasKids || childAlpha <= 0.01) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(own.x, own.y, own.w, own.h);
    ctx.clip();
    drawEdges(node, childAlpha);
    for (const kid of node.kids) {
      const child = model.nodes[kid];
      if (child !== undefined) drawNode(child, childAlpha, depth + 1, isLit, dimmedAbove || dimmed);
    }
    ctx.restore();
  };

  drawGrid();
  const root = model.nodes[0];
  if (root !== undefined) drawNode(root, 1, 0, false, false);
}

/** The cards a viewer is inside: from the root down, each card that is open and holds the middle of the view. */
export function focusChain(model: MapModel, camera: Camera, size: Size): number[] {
  const th = thresholds(size);
  const centre = { x: size.w / 2, y: size.h / 2 };
  const chain: number[] = [];
  let current = model.nodes[0];
  while (current !== undefined) {
    let next: MapNode | undefined;
    for (const kid of current.kids) {
      const rect = model.rects[kid];
      if (rect === undefined) continue;
      const origin = worldToScreen(camera, size, rect.x, rect.y);
      const w = rect.w * camera.scale;
      const h = rect.h * camera.scale;
      if (centre.x >= origin.x && centre.x <= origin.x + w && centre.y >= origin.y && centre.y <= origin.y + h) {
        const node = model.nodes[kid];
        if (node !== undefined && openness(w, th, node.kids.length > 0) >= 0.5) next = node;
        break;
      }
    }
    if (next === undefined) break;
    chain.push(next.i);
    current = next;
  }
  return chain;
}
