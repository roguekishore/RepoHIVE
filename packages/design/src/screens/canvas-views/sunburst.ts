import type { HierarchyScale } from "./view-types";

export type HierarchyArc = HierarchyScale["arcs"][number];

/** The centre, the hub radius and the width of one ring, for a stage of a given size and a tree of a given depth. */
export interface SunLayout {
  readonly cx: number;
  readonly cy: number;
  /** Radius of the hub inside the first ring. */
  readonly hub: number;
  readonly ring: number;
}

const MARGIN = 16;
const HUB_SHARE = 0.22;
const GAP = 1;

export function sunLayout(width: number, height: number, maxLevel: number): SunLayout {
  const radius = Math.max(0, Math.min(width, height) / 2 - MARGIN);
  const hub = radius * HUB_SHARE;
  return { cx: width / 2, cy: height / 2, hub, ring: (radius - hub) / Math.max(1, maxLevel) };
}

const TAU = Math.PI * 2;
/** An arc that wraps the whole circle cannot be drawn as one SVG arc; it stops this short of closing. */
const FULL_TURN_EPSILON = 0.0001;

const fixed = (value: number): string => value.toFixed(2);

/** The SVG path of one ring segment. `start` and `span` are turns, measured clockwise from twelve o'clock. */
export function arcPath(layout: SunLayout, level: number, start: number, span: number): string {
  const inner = layout.hub + (level - 1) * layout.ring + GAP;
  const outer = layout.hub + level * layout.ring - GAP;
  const a0 = start * TAU - Math.PI / 2;
  let a1 = (start + span) * TAU - Math.PI / 2;
  if (span >= 0.9999) a1 = a0 + TAU - FULL_TURN_EPSILON;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const point = (angle: number, radius: number): string =>
    `${fixed(layout.cx + Math.cos(angle) * radius)} ${fixed(layout.cy + Math.sin(angle) * radius)}`;
  return `M${point(a0, outer)} A${fixed(outer)} ${fixed(outer)} 0 ${large} 1 ${point(a1, outer)} L${point(a1, inner)} A${fixed(inner)} ${fixed(inner)} 0 ${large} 0 ${point(a0, inner)} Z`;
}

/** How a segment is drawn. `wrapper` also stands for a node with no recorded decision. */
export type SunState = "wrapper" | "kept" | "rebuilt" | "unassessed";

export function sunState(arc: HierarchyArc): SunState {
  if (arc.wrapper) return "wrapper";
  switch (arc.state) {
    case "preserve":
      return "kept";
    case "reconstruct":
      return "rebuilt";
    case "degenerate":
      return "unassessed";
    case "none":
      return "wrapper";
  }
}

/** The arcs' neighbours, for the keyboard: each arc's parent, first child, and the next and previous arc on its ring. */
export interface ArcTree {
  readonly parent: readonly number[];
  readonly firstChild: readonly number[];
  readonly next: readonly number[];
  readonly previous: readonly number[];
  /** The arcs on the first ring, in order. */
  readonly roots: readonly number[];
}

const EPSILON = 1e-9;

/**
 * Finds each arc's parent by angle: the arc one ring in whose sweep contains this arc's midpoint. The view records the
 * sweep of every arc and no parent id, and a sweep is nested inside its parent's by construction. -1 means none.
 */
export function buildArcTree(arcs: readonly HierarchyArc[]): ArcTree {
  const byLevel = new Map<number, number[]>();
  arcs.forEach((arc, index) => {
    const ring = byLevel.get(arc.level);
    if (ring === undefined) byLevel.set(arc.level, [index]);
    else ring.push(index);
  });
  for (const ring of byLevel.values()) ring.sort((a, b) => arcs[a]!.start - arcs[b]!.start || a - b);

  const parent = new Array<number>(arcs.length).fill(-1);
  const firstChild = new Array<number>(arcs.length).fill(-1);
  const next = new Array<number>(arcs.length).fill(-1);
  const previous = new Array<number>(arcs.length).fill(-1);

  for (const ring of byLevel.values()) {
    ring.forEach((index, position) => {
      previous[index] = position > 0 ? ring[position - 1]! : -1;
      next[index] = position < ring.length - 1 ? ring[position + 1]! : -1;
    });
  }

  for (const [level, ring] of byLevel) {
    const outer = byLevel.get(level - 1);
    if (outer === undefined) continue;
    for (const index of ring) {
      const arc = arcs[index]!;
      const middle = arc.start + arc.span / 2;
      // The last outer-ring arc that starts at or before the midpoint.
      let low = 0;
      let high = outer.length - 1;
      let found = -1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (arcs[outer[mid]!]!.start <= middle + EPSILON) {
          found = mid;
          low = mid + 1;
        } else high = mid - 1;
      }
      if (found < 0) continue;
      const candidate = outer[found]!;
      const c = arcs[candidate]!;
      if (middle > c.start + c.span + EPSILON) continue;
      parent[index] = candidate;
      if (firstChild[candidate] === -1) firstChild[candidate] = index;
    }
  }

  return { parent, firstChild, next, previous, roots: byLevel.get(1) ?? [] };
}
