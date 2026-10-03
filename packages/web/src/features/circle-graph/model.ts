/**
 * The circle graph's scene model. Pure, browser-free and unit-testable.
 *
 * Built once per snapshot from the zoom map (the containment tree and the
 * sibling relations) plus, when it has loaded, the blast-radius view's leaf
 * edges:
 *
 * - **Chain collapsing.** A node with exactly one child adds a zoom step that
 *   shows nothing new, so a run of single-child nodes becomes one circle whose
 *   label is the joined path. Its id is the deepest node of the run, because that
 *   node's children are what it opens into.
 * - **Layout.** Every circle gets an absolute world position; the root fills the
 *   unit box, centred on `(0.5, 0.5)` with radius `0.5`. Children are placed by
 *   `forceLayout`, pulled together by their sibling relations.
 * - **Links.** Leaf edges are kept as pairs of the finest circles that show
 *   their ends. `linksOf` answers "what does this circle depend on, and what
 *   depends on it" for a selection; the renderer then lifts each far end to
 *   whatever circle is visible at the current zoom.
 */

import type { BlastRadiusData } from "@repohive/views";
import type { ZoomMap, ZoomNode, ZoomRelation } from "@/features/structure-map/canvas";
import { type LayoutLink, childRadii, forceLayout } from "./graph-layout";

export interface CircleNode {
  /** The deepest zoom node of the collapsed run; its children are this circle's children. */
  id: string;
  /** The collapsed run, outermost first (length 1 when nothing collapsed). */
  chain: ZoomNode[];
  node: ZoomNode;
  label: string;
  parentId: string | null;
  children: string[];
  depth: number;
  /** Absolute world circle. */
  x: number;
  y: number;
  r: number;
}

/** Dependency counts between one selection and the circles on the other end. */
export interface SelectionLinks {
  /** The selection depends on these (finest circle id -> leaf edge count). */
  out: Map<string, number>;
  /** These depend on the selection. */
  in: Map<string, number>;
}

export interface CircleModel {
  rootId: string;
  nodes: Map<string, CircleNode>;
  /** Every zoom-node id to the circle that shows it. */
  circleOf: Map<string, string>;
  /** Directed links between the finest circles, with leaf-edge counts. */
  links: Array<{ source: string; target: string; count: number }>;
  /** True when `links` comes from leaf edges; false when only sibling relations were available. */
  leafLinks: boolean;
}

export function buildCircleModel(map: ZoomMap, blast: BlastRadiusData | null = null): CircleModel {
  const byId = new Map(map.nodes.map((n) => [n.id, n] as const));
  const nodes = new Map<string, CircleNode>();
  const circleOf = new Map<string, string>();

  const relationsByParent = new Map<string, ZoomRelation[]>();
  for (const rel of map.relations) {
    const list = relationsByParent.get(rel.parent_id);
    if (list) list.push(rel);
    else relationsByParent.set(rel.parent_id, [rel]);
  }

  const collapse = (start: ZoomNode): ZoomNode[] => {
    const chain = [start];
    let cur = start;
    while (cur.children.length === 1) {
      const next = byId.get(cur.children[0]!);
      if (!next) break;
      chain.push(next);
      cur = next;
    }
    return chain;
  };

  const root = byId.get(map.root_id);
  if (!root) return { rootId: map.root_id, nodes, circleOf, links: [], leafLinks: false };

  const siblingLinks: CircleModel["links"] = [];
  const queue: Array<{ chain: ZoomNode[]; parentId: string | null; depth: number; x: number; y: number; r: number }> = [
    { chain: collapse(root), parentId: null, depth: 0, x: 0.5, y: 0.5, r: 0.5 },
  ];

  while (queue.length > 0) {
    const item = queue.shift()!;
    const node = item.chain[item.chain.length - 1]!;
    const kids = node.children
      .map((id) => byId.get(id))
      .filter((n): n is ZoomNode => n !== undefined)
      .sort((a, b) => a.sibling_rank - b.sibling_rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(collapse);

    const index = new Map(kids.map((chain, i) => [chain[0]!.id, i]));
    const links: LayoutLink[] = [];
    const finest = (i: number) => kids[i]![kids[i]!.length - 1]!.id;
    for (const rel of relationsByParent.get(node.id) ?? []) {
      const a = index.get(rel.source_id);
      const b = index.get(rel.target_id);
      if (a === undefined || b === undefined || a === b) continue;
      links.push({ a, b, weight: rel.edge_count });
      siblingLinks.push({ source: finest(a), target: finest(b), count: rel.edge_count });
    }
    const radii = childRadii(kids.map((chain) => chain[0]!.metrics.file_count));
    const centres = forceLayout(radii, links);

    nodes.set(node.id, {
      id: node.id,
      chain: item.chain,
      node,
      label: item.chain.map((n) => n.name).join(" / "),
      parentId: item.parentId,
      children: kids.map((_, i) => finest(i)),
      depth: item.depth,
      x: item.x,
      y: item.y,
      r: item.r,
    });
    for (const z of item.chain) circleOf.set(z.id, node.id);

    kids.forEach((chain, i) => {
      queue.push({
        chain,
        parentId: node.id,
        depth: item.depth + 1,
        x: item.x + centres[i]!.x * item.r,
        y: item.y + centres[i]!.y * item.r,
        r: radii[i]! * item.r,
      });
    });
  }

  if (!blast) return { rootId: root.id, nodes, circleOf, links: siblingLinks, leafLinks: false };
  return { rootId: root.id, nodes, circleOf, links: leafLinks(circleOf, blast), leafLinks: true };
}

/** Leaf edges as counted pairs of the finest circles showing their ends. */
function leafLinks(circleOf: Map<string, string>, blast: BlastRadiusData): CircleModel["links"] {
  // Functions and classes sit below the zoom map's file leaves: walk up to the first shown ancestor.
  const shown: (string | null | undefined)[] = new Array(blast.ids.length);
  const resolve = (pos: number): string | null => {
    const trail: number[] = [];
    let p = pos;
    let found: string | null = null;
    while (p >= 0) {
      const cached = shown[p];
      if (cached !== undefined) {
        found = cached;
        break;
      }
      trail.push(p);
      const circle = circleOf.get(blast.ids[p]!);
      if (circle) {
        found = circle;
        break;
      }
      p = blast.parents[p]!;
    }
    for (const t of trail) shown[t] = found;
    return found;
  };

  const counts = new Map<string, number>();
  for (const [s, t] of blast.edges) {
    const a = resolve(s);
    const b = resolve(t);
    if (!a || !b || a === b) continue;
    const key = `${a}\u0000${b}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([key, count]) => {
      const [source, target] = key.split("\u0000") as [string, string];
      return { source, target, count };
    })
    .sort((x, y) => (x.source < y.source ? -1 : x.source > y.source ? 1 : x.target < y.target ? -1 : x.target > y.target ? 1 : 0));
}

/** Is `id` the circle `ancestor` or inside it? */
export function isWithin(model: CircleModel, id: string, ancestor: string): boolean {
  let cur: CircleNode | undefined = model.nodes.get(id);
  while (cur) {
    if (cur.id === ancestor) return true;
    cur = cur.parentId ? model.nodes.get(cur.parentId) : undefined;
  }
  return false;
}

/** What the selected circle depends on and what depends on it, excluding links inside it. */
export function linksOf(model: CircleModel, selectedId: string): SelectionLinks {
  const out = new Map<string, number>();
  const inbound = new Map<string, number>();
  const inside = new Map<string, boolean>();
  const within = (id: string) => {
    let v = inside.get(id);
    if (v === undefined) inside.set(id, (v = isWithin(model, id, selectedId)));
    return v;
  };
  for (const link of model.links) {
    const s = within(link.source);
    const t = within(link.target);
    if (s && !t) out.set(link.target, (out.get(link.target) ?? 0) + link.count);
    else if (t && !s) inbound.set(link.source, (inbound.get(link.source) ?? 0) + link.count);
  }
  return { out, in: inbound };
}

/** Root-first path of circles to `id`. */
export function circlePath(model: CircleModel, id: string): CircleNode[] {
  const path: CircleNode[] = [];
  let cur = model.nodes.get(id);
  while (cur) {
    path.push(cur);
    cur = cur.parentId ? model.nodes.get(cur.parentId) : undefined;
  }
  return path.reverse();
}
