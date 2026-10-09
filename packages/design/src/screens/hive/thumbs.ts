/**
 * The seven view previews on the Hive landing, drawn on canvas from the committed figures. Colours come from the
 * palette the caller reads; nothing here holds a colour. Ported from the approved Hive Core artifact.
 */
import { mixColors, rgbaCss, type CanvasPalette, type Rgba } from "../../canvas/colors";
import type { LandingFigures } from "../landing/figures-types";

export type ViewId = "map" | "decisions" | "hierarchy" | "architecture" | "baseline" | "overview" | "adaptivity";

export const VIEWS: readonly { readonly id: ViewId; readonly name: string; readonly text: string }[] = [
  { id: "map", name: "Map", text: "Zoom from the whole repository into regions, groups and files. Hover a file to trace what it depends on." },
  { id: "decisions", name: "Decisions", text: "Every region on one axis, with the line that decides it." },
  { id: "hierarchy", name: "Hierarchy", text: "Every level at once. Radius is depth, sweep is files." },
  { id: "architecture", name: "Architecture", text: "Which groups depend on which, and how far each package was split." },
  { id: "baseline", name: "Baseline", text: "The flat file graph before any hierarchy, for comparison." },
  { id: "overview", name: "Overview", text: "The repository in figures: its size, its largest regions and the snapshot it came from." },
  { id: "adaptivity", name: "Adaptivity", text: "How many regions were kept, and how their scores spread around the line." },
];

interface Colours {
  surface: Rgba;
  sunken: Rgba;
  line: Rgba;
  ls: Rgba;
  fg: Rgba;
  fg2: Rgba;
  fg3: Rgba;
  acc: Rgba;
}

function coloursOf(palette: CanvasPalette): Colours {
  const c = palette.colors;
  return { surface: c.surface, sunken: c.sunken, line: c.line, ls: c["line-strong"], fg: c.fg, fg2: c["fg-2"], fg3: c["fg-3"], acc: c.accent };
}

interface Item {
  readonly n: number;
  readonly v: number;
}

/** Squarified treemap: `out` receives `[node, x, y, w, h]`. */
function squarify(items: readonly Item[], x0: number, y0: number, w0: number, h0: number, out: [number, number, number, number, number][]): void {
  let x = x0;
  let y = y0;
  let w = w0;
  let h = h0;
  const total = items.reduce((s, i) => s + i.v, 0);
  if (!total || w <= 0 || h <= 0) return;
  const scale = (w * h) / total;
  let rest = items.map((i) => ({ n: i.n, a: i.v * scale }));
  while (rest.length) {
    const short = Math.max(1e-6, Math.min(w, h));
    let best = Infinity;
    let take = 1;
    let sum = 0;
    let mx = 0;
    let mn = Infinity;
    for (let k = 0; k < rest.length; k++) {
      const a = rest[k]!.a;
      const s2 = sum + a;
      const mx2 = Math.max(mx, a);
      const mn2 = Math.min(mn, a);
      const worst = Math.max((short * short * mx2) / (s2 * s2), (s2 * s2) / (short * short * mn2));
      if (worst <= best) {
        best = worst;
        take = k + 1;
        sum = s2;
        mx = mx2;
        mn = mn2;
      } else break;
    }
    const row = rest.slice(0, take);
    if (w >= h) {
      const cw = sum / h;
      let yy = y;
      row.forEach((o) => {
        const ch = o.a / cw;
        out.push([o.n, x, yy, cw, ch]);
        yy += ch;
      });
      x += cw;
      w -= cw;
    } else {
      const ch = sum / w;
      let xx = x;
      row.forEach((o) => {
        const cw = o.a / ch;
        out.push([o.n, xx, y, cw, ch]);
        xx += cw;
      });
      y += ch;
      h -= ch;
    }
    rest = rest.slice(take);
  }
}

const kidsCache = new WeakMap<LandingFigures, Map<number, number[]>>();
function kidsOf(figures: LandingFigures): Map<number, number[]> {
  const hit = kidsCache.get(figures);
  if (hit) return hit;
  const kids = new Map<number, number[]>();
  figures.map.forEach((row, i) => {
    if (row[0] >= 0) {
      const list = kids.get(row[0]);
      if (list) list.push(i);
      else kids.set(row[0], [i]);
    }
  });
  kids.forEach((list) => list.sort((a, b) => figures.map[a]![2] - figures.map[b]![2]));
  kidsCache.set(figures, kids);
  return kids;
}

type Painter = (ctx: CanvasRenderingContext2D, W: number, H: number, P: Colours, mono: string, figures: LandingFigures) => void;
const css = rgbaCss;

const PAINT: Record<Exclude<ViewId, "overview">, Painter> = {
  map(ctx, W, H, P, _mono, F) {
    const kids = kidsOf(F);
    ctx.fillStyle = css(P.surface);
    ctx.fillRect(0, 0, W, H);
    const pad = Math.max(8, W * 0.03);
    const walk = (n: number, x: number, y: number, w: number, h: number, d: number): void => {
      if (w < 1.2 || h < 1.2) return;
      const k = F.map[n]![3];
      if (d === 1) {
        ctx.fillStyle = css(P.sunken);
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = css(P.ls);
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      } else if (d === 2) {
        ctx.fillStyle = css(P.surface);
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = css(P.line);
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      } else if (d >= 3) {
        ctx.fillStyle = k === 1 ? css(P.fg, 0.88) : k === 2 ? css(P.acc, 0.22 + 0.5 * (((n * 37) % 7) / 7)) : css(P.ls, 0.55);
        ctx.fillRect(x + 0.6, y + 0.6, Math.max(0, w - 1.2), Math.max(0, h - 1.2));
      }
      const children = kids.get(n);
      if (!children) return;
      const ins = d === 0 ? 0 : d === 1 ? 4 : 2;
      const top = d === 1 ? 3 : 0;
      const out: [number, number, number, number, number][] = [];
      squarify(
        children.map((c) => ({ n: c, v: F.map[c]![1] })).sort((a, b) => b.v - a.v),
        x + ins,
        y + ins + top,
        w - ins * 2,
        h - ins * 2 - top,
        out,
      );
      out.forEach(([c, a, b, cw, chh]) => walk(c, a, b, cw, chh, d + 1));
    };
    walk(0, pad, pad, W - pad * 2, H - pad * 2, 0);
  },

  decisions(ctx, W, H, P, mono, F) {
    ctx.fillStyle = css(P.surface);
    ctx.fillRect(0, 0, W, H);
    const pad = Math.max(14, W * 0.05);
    const base = H - Math.max(26, H * 0.16);
    const s = Math.max(3, Math.min(6, W / 110));
    const cols: Record<number, number> = {};
    const x = (v: number): number => pad + v * (W - pad * 2);
    ctx.strokeStyle = css(P.line);
    ctx.lineWidth = 1;
    ctx.fillStyle = css(P.fg3);
    ctx.font = `11px ${mono}`;
    ctx.textAlign = "center";
    for (let i = 0; i <= 10; i += 2) {
      const xx = x(i / 10);
      ctx.beginPath();
      ctx.moveTo(xx, 10);
      ctx.lineTo(xx, base);
      ctx.stroke();
      ctx.fillText((i / 10).toFixed(1), xx, base + 16);
    }
    ctx.strokeStyle = css(P.ls);
    ctx.beginPath();
    ctx.moveTo(pad, base);
    ctx.lineTo(W - pad, base);
    ctx.stroke();
    F.regions
      .slice()
      .sort((a, b) => a[4] - b[4])
      .forEach((r) => {
        const c = Math.round(x(r[4]) / (s + 1));
        const n = (cols[c] = (cols[c] ?? 0) + 1);
        const cx = c * (s + 1);
        const cy = base - 3 - (n - 0.5) * (s + 1);
        if (cy < 6) return;
        if (r[5] === 1) {
          ctx.fillStyle = css(P.fg);
          ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
        } else {
          ctx.fillStyle = css(P.acc);
          ctx.beginPath();
          ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    const bx = x(F.settings.boundary);
    ctx.strokeStyle = css(P.acc);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, 4);
    ctx.lineTo(bx, base + 4);
    ctx.stroke();
  },

  hierarchy(ctx, W, H, P, _mono, F) {
    ctx.fillStyle = css(P.surface);
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.44;
    const r0 = R * 0.2;
    const rw = (R - r0) / 4;
    ctx.fillStyle = css(P.fg);
    ctx.beginPath();
    ctx.arc(cx, cy, r0 - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = css(P.surface);
    F.arcs.forEach(([ring, start, span, , k]) => {
      if (span < 0.0008) return;
      const a0 = start * Math.PI * 2 - Math.PI / 2;
      const a1 = (start + span) * Math.PI * 2 - Math.PI / 2;
      const ri = r0 + (ring - 1) * rw;
      const ro = ri + rw - 2;
      ctx.fillStyle = k === 1 ? css(P.fg) : k === 2 ? css(P.acc) : k === 3 ? css(P.line) : css(mixColors(P.ls, P.fg, 0.12 * ring));
      ctx.beginPath();
      ctx.arc(cx, cy, ro, a0, a1);
      ctx.arc(cx, cy, ri, a1, a0, true);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  },

  architecture(ctx, W, H, P, _mono, F) {
    ctx.fillStyle = css(P.surface);
    ctx.fillRect(0, 0, W, H);
    const D = F.dsm;
    const side = Math.min(W, H) * 0.84;
    const cell = side / D.n;
    const ox = (W - side) / 2;
    const oy = (H - side) / 2;
    const blockOf = (i: number): (typeof D.blocks)[number] | undefined => D.blocks.find((b) => i >= b[0] && i < b[0] + b[1]);
    ctx.strokeStyle = css(P.line);
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 0.5, oy - 0.5, side + 1, side + 1);
    D.entries.forEach(([r, c, w]) => {
      const b = blockOf(r);
      const same = b !== undefined && b === blockOf(c);
      const a = 0.25 + 0.75 * Math.sqrt(w / D.max);
      ctx.fillStyle = same && b[2] === 2 ? css(P.acc, a) : css(P.fg, a * (same ? 1 : 0.55));
      ctx.fillRect(ox + c * cell + 0.5, oy + r * cell + 0.5, cell - 1, cell - 1);
    });
    D.blocks.forEach(([s0, n, k]) => {
      ctx.setLineDash(k === 2 ? [4, 3] : []);
      ctx.strokeStyle = k === 2 ? css(P.acc) : css(P.fg2);
      ctx.lineWidth = 1.2;
      ctx.strokeRect(ox + s0 * cell, oy + s0 * cell, n * cell, n * cell);
    });
    ctx.setLineDash([]);
  },

  baseline(ctx, W, H, P, _mono, F) {
    ctx.fillStyle = css(P.surface);
    ctx.fillRect(0, 0, W, H);
    const s = (Math.min(W, H) * 0.92) / 1000;
    const ox = W / 2 - 500 * s;
    const oy = H / 2 - 504 * s;
    const pts = F.flat.points;
    const L = F.flat.links;
    ctx.strokeStyle = css(P.fg3, 0.22);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let k = 0; k < L.length; k += 2) {
      const a = pts[L[k]!]!;
      const b = pts[L[k + 1]!]!;
      ctx.moveTo(ox + a[0] * s, oy + a[1] * s);
      ctx.lineTo(ox + b[0] * s, oy + b[1] * s);
    }
    ctx.stroke();
    ctx.fillStyle = css(P.fg, 0.8);
    pts.forEach((p) => ctx.fillRect(ox + p[0] * s - 0.8, oy + p[1] * s - 0.8, 1.6, 1.6));
  },

  adaptivity(ctx, W, H, P, mono, F) {
    ctx.fillStyle = css(P.surface);
    ctx.fillRect(0, 0, W, H);
    const B = 25;
    const bins = new Array<number>(B).fill(0);
    F.regions.forEach((r) => {
      const i = Math.min(B - 1, Math.floor(r[4] * B));
      bins[i] = bins[i]! + 1;
    });
    const pad = Math.max(14, W * 0.04);
    const base = H - 30;
    const top = 16;
    const mx = Math.max(...bins);
    const bw = (W - pad * 2) / B;
    ctx.font = `11px ${mono}`;
    ctx.textAlign = "center";
    bins.forEach((v, i) => {
      const h = ((base - top) * v) / mx;
      const c = (i + 0.5) / B;
      ctx.fillStyle = c >= F.settings.boundary ? css(P.fg) : css(P.acc);
      ctx.fillRect(pad + i * bw + 1, base - h, bw - 2, h);
    });
    ctx.strokeStyle = css(P.ls);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, base + 0.5);
    ctx.lineTo(W - pad, base + 0.5);
    ctx.stroke();
    ctx.fillStyle = css(P.fg3);
    [0, 0.5, 1].forEach((v) => ctx.fillText(v.toFixed(1), pad + v * (W - pad * 2), base + 18));
    const bx = pad + F.settings.boundary * (W - pad * 2);
    ctx.strokeStyle = css(P.acc);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, top - 6);
    ctx.lineTo(bx, base);
    ctx.stroke();
  },
};

/** Paints view `id` (any but the overview, which is markup) at `W` by `H` CSS pixels. */
export function paintThumb(id: Exclude<ViewId, "overview">, ctx: CanvasRenderingContext2D, W: number, H: number, palette: CanvasPalette, figures: LandingFigures): void {
  PAINT[id](ctx, W, H, coloursOf(palette), palette.mono, figures);
}
