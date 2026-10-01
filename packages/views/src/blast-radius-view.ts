/**
 * Blast radius (`GET /api/graph/{id}/blast-radius?node=<id>`): the impacted set
 * for the E6 highlight: every node whose dependency path reaches the selected
 * node's subtree, rolled up to the map-visible ancestor cards (files + groups)
 * so a containing card lights up at any zoom level.
 *
 * This mirrors `@repohive/core`'s `analyzeBlastRadius` reverse-reachability
 * (dependent -> dependency over `leafEdges`) with NO engine change. It is
 * generalised to a *set* of seeds because the map's leaf is the `file` node
 * while the engine's edges are class/function-level: selecting a file (or a
 * group) seeds from that subtree's graph leaves, so the reach is meaningful
 * rather than empty. Blast radius is static reachability and may under-count
 * dynamic dependencies (reflection, DI): an honest, documented caveat.
 *
 * Two entry points. `computeBlastRadius` is the route's traversal, moved
 * without behaviour change. `buildBlastRadiusData` is the hosted data file: it
 * carries exactly what that traversal reads, so the browser can run it.
 */
import type { Hierarchy } from "@repohive/core";

/** Descendant graph-leaf ids (file/class/function) under `startId`, inclusive. */
function subtreeLeafSeeds(hierarchy: Hierarchy, startId: string): string[] {
  const seeds: string[] = [];
  const stack = [startId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = hierarchy.nodes.get(id);
    if (!node) continue;
    if (node.kind === "file" || node.kind === "class" || node.kind === "function") {
      seeds.push(id);
    }
    for (const childId of node.childIds) stack.push(childId);
  }
  return seeds;
}

export interface BlastRadiusResult {
  node: string;
  count: number;
  ids: string[];
}

/** The route body for a node that exists in the hierarchy. */
export function computeBlastRadius(hierarchy: Hierarchy, nodeId: string): BlastRadiusResult {
  // Reverse adjacency (target -> its dependents), built once.
  const dependentsOf = new Map<string, string[]>();
  for (const edge of hierarchy.leafEdges) {
    const list = dependentsOf.get(edge.target);
    if (list) list.push(edge.source);
    else dependentsOf.set(edge.target, [edge.source]);
  }

  // Multi-source reverse BFS from the selected subtree's graph leaves.
  const seeds = subtreeLeafSeeds(hierarchy, nodeId);
  const impacted = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of dependentsOf.get(current) ?? []) {
      if (!impacted.has(dependent)) {
        impacted.add(dependent);
        queue.push(dependent);
      }
    }
  }

  // Roll each impacted graph node up to its map-visible ancestors (the file it
  // lives in and every enclosing group), so a card lights up at any zoom level.
  const highlight = new Set<string>();
  for (const impactedId of impacted) {
    let node = hierarchy.nodes.get(impactedId);
    while (node) {
      if (node.kind === "file" || node.kind === "group") highlight.add(node.id);
      if (node.parentId === null) break;
      node = hierarchy.nodes.get(node.parentId);
    }
  }

  return {
    node: nodeId,
    count: highlight.size,
    ids: [...highlight].sort(),
  };
}

/**
 * The hosted blast-radius data: the leaf edges (`[source, target]` positions
 * into `ids`) and each node's kind, parent and children, which is everything
 * `computeBlastRadius` reads. Nodes are in id order and positions index `ids`;
 * `parent` is `-1` for the root and `children` are positions in the node's own
 * `childIds` order (the traversal's visit order is not part of its result, but
 * is kept).
 */
export interface BlastRadiusData {
  /** Node ids, in canonical (byte-wise ascending) order. */
  ids: string[];
  kinds: string[];
  /** Parent position per node, `-1` for none. */
  parents: number[];
  /** Child positions per node. */
  children: number[][];
  /** Leaf edges as `[source position, target position]`, in the hierarchy's order. */
  edges: [number, number][];
}

export function buildBlastRadiusData(hierarchy: Hierarchy): BlastRadiusData {
  const ids = [...hierarchy.nodes.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const position = new Map<string, number>();
  ids.forEach((id, i) => position.set(id, i));
  const kinds: string[] = [];
  const parents: number[] = [];
  const children: number[][] = [];
  for (const id of ids) {
    const node = hierarchy.nodes.get(id)!;
    kinds.push(node.kind);
    parents.push(node.parentId === null ? -1 : (position.get(node.parentId) ?? -1));
    children.push(node.childIds.flatMap((childId) => (position.has(childId) ? [position.get(childId)!] : [])));
  }
  const edges: [number, number][] = [];
  for (const edge of hierarchy.leafEdges) {
    const source = position.get(edge.source);
    const target = position.get(edge.target);
    if (source !== undefined && target !== undefined) edges.push([source, target]);
  }
  return { ids, kinds, parents, children, edges };
}
