import type { CSSProperties, ReactElement } from "react";
import type { ArcKindCode, LandingFigures, MapRow } from "./figures-types";

/**
 * The previews on the landing's seven view cards. Every mark is drawn from the committed figures of a real index; the
 * colours are the landing's roles (ink = authored, accent = computed) and each mark carries its entrance delay in `--d`.
 */

const KEPT = "var(--rh-landing-kept)";
const REBUILT = "var(--rh-landing-rebuilt)";
const SMALL = "var(--rh-landing-small)";

const delay = (ms: number): CSSProperties => ({ "--d": `${Math.round(ms)}ms` }) as CSSProperties;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface MapNodeModel {
  readonly i: number;
  readonly parent: number;
  readonly files: number;
  readonly rank: number;
  readonly kind: ArcKindCode;
  readonly kids: MapNodeModel[];
}

/** Lays one parent's children out as rows of cards sized by their file count, centred in the unit square. */
export function packKids(kids: readonly MapNodeModel[], parentAspect: number): Map<number, Box> {
  const out = new Map<number, Box>();
  const n = kids.length;
  if (n === 0) return out;
  const gap = 0.3;
  const aspect = Math.min(8, Math.max(0.2, 1.5 / (parentAspect || 1)));
  let lo = Infinity;
  let hi = -Infinity;
  for (const kid of kids) {
    lo = Math.min(lo, kid.files);
    hi = Math.max(hi, kid.files);
  }
  const cards = kids.map((kid) => {
    const normal = hi - lo > 1e-9 ? (kid.files - lo) / (hi - lo) : 1;
    const h = 0.58 + 0.42 * Math.pow(normal, 0.7);
    return { i: kid.i, w: h * aspect, h };
  });
  const a2 = Math.min(6, Math.max(1 / 6, parentAspect || 1));
  const cols0 = n === 1 ? 1 : Math.min(n, Math.max(1, Math.round(Math.sqrt(n * a2))));
  const cols = n === 1 ? 1 : Math.ceil(n / Math.ceil(n / cols0));
  const avgW = cards.reduce((sum, card) => sum + card.w, 0) / n;
  const target = cols * avgW + Math.max(0, cols - 1) * gap;
  const rows: (typeof cards)[] = [];
  let current: typeof cards = [];
  let width = 0;
  for (const card of cards) {
    const add = (current.length > 0 ? gap : 0) + card.w;
    if (current.length > 0 && width + add > target) {
      rows.push(current);
      current = [];
      width = 0;
    }
    width += (current.length > 0 ? gap : 0) + card.w;
    current.push(card);
  }
  if (current.length > 0) rows.push(current);
  const rowW = (row: typeof cards): number => row.reduce((sum, card) => sum + card.w, 0) + Math.max(0, row.length - 1) * gap;
  const rowH = (row: typeof cards): number => row.reduce((max, card) => Math.max(max, card.h), 0);
  const maxW = Math.max(...rows.map(rowW));
  const totalH = rows.reduce((sum, row) => sum + rowH(row), 0) + Math.max(0, rows.length - 1) * gap;
  const scale = Math.min(1 / maxW, 1 / totalH);
  const ox = (1 - maxW * scale) / 2;
  const oy = (1 - totalH * scale) / 2;
  let y = 0;
  for (const row of rows) {
    const h = rowH(row);
    let x = (maxW - rowW(row)) / 2;
    for (const card of row) {
      out.set(card.i, { x: ox + x * scale, y: oy + (y + (h - card.h) / 2) * scale, w: card.w * scale, h: card.h * scale });
      x += card.w + gap;
    }
    y += h + gap;
  }
  return out;
}

/** The map's containment tree with every node's place in the unit square. */
export function mapBoxes(rows: readonly MapRow[]): { readonly nodes: readonly MapNodeModel[]; readonly boxes: readonly Box[] } {
  const nodes: MapNodeModel[] = rows.map((row, i) => ({ i, parent: row[0], files: row[1], rank: row[2], kind: row[3], kids: [] }));
  for (const node of nodes) if (node.parent >= 0) nodes[node.parent]?.kids.push(node);
  for (const node of nodes) node.kids.sort((a, b) => a.rank - b.rank || a.i - b.i);
  const boxes: Box[] = [];
  boxes[0] = { x: 0, y: 0, w: 1, h: 1 };
  const stack = [0];
  while (stack.length > 0) {
    const id = stack.pop() as number;
    const node = nodes[id];
    const parentBox = boxes[id];
    if (node === undefined || parentBox === undefined || node.kids.length === 0) continue;
    const local = packKids(node.kids, parentBox.h > 0 ? parentBox.w / parentBox.h : 1);
    for (const kid of node.kids) {
      const l = local.get(kid.i);
      if (l === undefined) continue;
      boxes[kid.i] = { x: parentBox.x + l.x * parentBox.w, y: parentBox.y + l.y * parentBox.h, w: l.w * parentBox.w, h: l.h * parentBox.h };
      stack.push(kid.i);
    }
  }
  return { nodes, boxes };
}

function depthOf(nodes: readonly MapNodeModel[], node: MapNodeModel): number {
  let depth = 0;
  let current = node;
  while (current.parent >= 0) {
    depth += 1;
    const next = nodes[current.parent];
    if (next === undefined) break;
    current = next;
  }
  return depth;
}

export function MapThumb({ figures }: { readonly figures: LandingFigures }): ReactElement {
  const { nodes, boxes } = mapBoxes(figures.map);
  return (
    <svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {nodes.map((node) => {
        const depth = depthOf(nodes, node);
        const box = boxes[node.i];
        if (depth < 1 || depth > 3 || box === undefined) return null;
        const x = 100 + box.x * 400;
        const y = box.y * 400;
        const stroke = node.kind === 2 ? REBUILT : node.kind === 1 ? KEPT : depth === 1 ? "var(--rh-line-strong)" : "var(--rh-fg-3)";
        return (
          <rect
            key={node.i}
            className="rh-ld-va"
            x={x.toFixed(1)}
            y={y.toFixed(1)}
            width={(box.w * 400).toFixed(1)}
            height={(box.h * 400).toFixed(1)}
            rx={depth === 3 ? 0.8 : 2}
            style={{
              ...delay((depth - 1) * 260 + (box.x + box.y) * 260),
              fill: depth === 2 ? "var(--rh-surface)" : "none",
              stroke,
              strokeDasharray: node.kind === 2 ? "2 1.5" : undefined,
              strokeWidth: depth === 3 ? 0.6 : 1,
            }}
          />
        );
      })}
    </svg>
  );
}

export function StripThumb({ figures }: { readonly figures: LandingFigures }): ReactElement {
  const columns = new Map<number, number>();
  const marks = [...figures.regions]
    .sort((a, b) => a[4] - b[4])
    .map((row) => {
      const x = Math.round((10 + row[4] * 280) / 4) * 4;
      const level = (columns.get(x) ?? 0) + 1;
      columns.set(x, level);
      return { name: row[0], x, y: 118 - (level - 1) * 4, kept: row[5] === 1, level };
    });
  return (
    <svg viewBox="0 0 300 140" aria-hidden="true">
      <line x1="10" x2="290" y1="122" y2="122" style={{ stroke: "var(--rh-line-strong)" }} />
      {marks.map((mark) => (
        <circle key={mark.name} className="rh-ld-va" cx={mark.x} cy={mark.y} r={1.7} style={{ ...delay(mark.x * 2.2 + mark.level * 14), fill: mark.kept ? KEPT : REBUILT }} />
      ))}
      <g className="rh-ld-bline">
        <line className="rh-ld-va rh-ld-va-grow" x1="150" x2="150" y1="12" y2="122" style={{ ...delay(700), stroke: "var(--rh-fg)", strokeWidth: 1.5, strokeDasharray: "3 3" }} />
      </g>
    </svg>
  );
}

const ARC_FILL: readonly string[] = ["var(--rh-sunken)", KEPT, REBUILT, SMALL];

export function SunburstThumb({ figures }: { readonly figures: LandingFigures }): ReactElement {
  const cx = 150;
  const cy = 150;
  const r0 = 30;
  const ring = 28;
  return (
    <svg viewBox="0 0 300 300" aria-hidden="true">
      <g className="rh-ld-spin">
        {figures.arcs.map((arc, index) => {
          const a0 = arc[1] * 2 * Math.PI - Math.PI / 2;
          let a1 = (arc[1] + arc[2]) * 2 * Math.PI - Math.PI / 2;
          const ri = r0 + (arc[0] - 1) * ring + 0.5;
          const ro = ri + ring - 1;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          if (arc[2] >= 0.9999) a1 = a0 + 2 * Math.PI - 0.001;
          const p = (t: number, r: number): string => `${(cx + Math.cos(t) * r).toFixed(1)} ${(cy + Math.sin(t) * r).toFixed(1)}`;
          return (
            <path
              key={index}
              className="rh-ld-va rh-ld-va-sun"
              d={`M${p(a0, ro)} A${ro} ${ro} 0 ${large} 1 ${p(a1, ro)} L${p(a1, ri)} A${ri} ${ri} 0 ${large} 0 ${p(a0, ri)}Z`}
              style={{ ...delay((arc[0] - 1) * 170 + arc[1] * 520), fill: ARC_FILL[arc[4]], stroke: "var(--rh-surface)", strokeWidth: 0.5 }}
            />
          );
        })}
      </g>
    </svg>
  );
}

export function DsmThumb({ figures }: { readonly figures: LandingFigures }): ReactElement {
  const { n, max, entries, blocks } = figures.dsm;
  const cell = 240 / n;
  return (
    <svg viewBox="-2 -2 244 244" aria-hidden="true">
      <rect x="0" y="0" width="240" height="240" style={{ fill: "none", stroke: "var(--rh-line-strong)" }} />
      {entries.map((entry, index) => (
        <rect
          key={index}
          className="rh-ld-va"
          x={(entry[1] * cell).toFixed(1)}
          y={(entry[0] * cell).toFixed(1)}
          width={cell.toFixed(2)}
          height={cell.toFixed(2)}
          opacity={(0.15 + 0.85 * Math.sqrt(entry[2] / max)).toFixed(2)}
          style={{ ...delay((entry[0] + entry[1]) * 11), fill: KEPT }}
        />
      ))}
      {blocks.map((block, index) => (
        <rect
          key={index}
          className="rh-ld-va"
          x={(block[0] * cell).toFixed(1)}
          y={(block[0] * cell).toFixed(1)}
          width={(block[1] * cell).toFixed(1)}
          height={(block[1] * cell).toFixed(1)}
          style={{ ...delay(500 + index * 90), fill: "none", stroke: block[2] === 1 ? "var(--rh-fg-3)" : REBUILT, strokeDasharray: block[2] === 2 ? "2 1.5" : undefined }}
        />
      ))}
    </svg>
  );
}

export function FlatThumb({ figures }: { readonly figures: LandingFigures }): ReactElement {
  const { points, links } = figures.flat;
  let edges = "";
  for (let k = 0; k + 1 < links.length; k += 2) {
    const a = points[links[k] as number];
    const b = points[links[k + 1] as number];
    if (a !== undefined && b !== undefined) edges += `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
  }
  let dots = "";
  for (let i = 0; i < points.length; i += 2) {
    const p = points[i];
    if (p !== undefined) dots += `M${p[0]} ${p[1]}h0.1`;
  }
  return (
    <svg viewBox="-20 -20 1040 1040" aria-hidden="true">
      <path className="rh-ld-va rh-ld-va-fade" d={edges} opacity="0.35" style={{ ...delay(500), stroke: "var(--rh-fg-3)", strokeWidth: 1.2, fill: "none" }} />
      <path className="rh-ld-va rh-ld-va-burst" d={dots} style={{ ...delay(0), stroke: "var(--rh-fg-2)", strokeWidth: 9, strokeLinecap: "round", fill: "none" }} />
    </svg>
  );
}

export function HistThumb({ figures }: { readonly figures: LandingFigures }): ReactElement {
  const bins = Array.from({ length: 20 }, () => ({ k: 0, r: 0 }));
  for (const row of figures.regions) {
    const bin = bins[Math.min(19, Math.floor(row[4] * 20))];
    if (bin === undefined) continue;
    if (row[5] === 1) bin.k += 1;
    else bin.r += 1;
  }
  const most = Math.max(1, ...bins.map((bin) => bin.k + bin.r));
  return (
    <svg viewBox="0 0 580 140" aria-hidden="true">
      {bins.map((bin, index) => {
        if (bin.k === 0 && bin.r === 0) return null;
        const x = 12 + index * 28;
        const hk = (bin.k / most) * 108;
        const hr = (bin.r / most) * 108;
        return (
          <g key={index} className="rh-ld-va rh-ld-va-grow" style={delay(index * 45)}>
            {hr > 0 ? <rect x={x} y={122 - hk - hr} width="22" height={hr} style={{ fill: REBUILT }} /> : null}
            {hk > 0 ? <rect x={x} y={122 - hk} width="22" height={hk} style={{ fill: KEPT }} /> : null}
          </g>
        );
      })}
      <line x1="8" x2="572" y1="122" y2="122" style={{ stroke: "var(--rh-line-strong)" }} />
      <line className="rh-ld-va rh-ld-va-grow" x1="292" x2="292" y1="6" y2="122" style={{ ...delay(900), stroke: "var(--rh-fg)", strokeWidth: 1.5, strokeDasharray: "3 3" }} />
    </svg>
  );
}
