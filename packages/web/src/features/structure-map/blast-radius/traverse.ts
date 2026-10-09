/**
 * The blast-radius traversal, run in the browser over
 * the snapshot's `views/blast-radius.json`. It is `computeBlastRadius`
 * (`@repohive/views`, the code behind the removed route) ported to the view's
 * position-indexed arrays: the same multi-source reverse BFS from the selected
 * subtree's graph leaves, rolled up to file and group ancestors.
 *
 * Pure and dependency-free so a Web Worker can bundle it. Type-only import of
 * the data shape; nothing from the engine ships to the browser.
 */
import type { BlastRadiusData } from "@repohive/views";

export interface BlastRadiusResult {
  node: string;
  count: number;
  ids: string[];
}

/** A built lookup over one snapshot's data: reverse edges and id positions, built once. */
export interface BlastRadiusIndex {
  data: BlastRadiusData;
  position: Map<string, number>;
  /** Dependents (edge sources) per target position. */
  dependents: Map<number, number[]>;
}

export function buildBlastRadiusIndex(data: BlastRadiusData): BlastRadiusIndex {
  const position = new Map<string, number>();
  data.ids.forEach((id, i) => position.set(id, i));
  const dependents = new Map<number, number[]>();
  for (const [source, target] of data.edges) {
    const list = dependents.get(target);
    if (list) list.push(source);
    else dependents.set(target, [source]);
  }
  return { data, position, dependents };
}

const isGraphLeaf = (kind: string) => kind === "file" || kind === "class" || kind === "function";

/** `undefined` when the node is not in the snapshot (the route's NODE_NOT_FOUND). */
export function computeBlastRadiusFromData(index: BlastRadiusIndex, nodeId: string): BlastRadiusResult | undefined {
  const { data, position, dependents } = index;
  const start = position.get(nodeId);
  if (start === undefined) return undefined;

  // Descendant graph leaves under the node, inclusive.
  const seeds: number[] = [];
  const stack = [start];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (isGraphLeaf(data.kinds[current]!)) seeds.push(current);
    for (const child of data.children[current]!) stack.push(child);
  }

  // Multi-source reverse BFS (dependent -> dependency edges, walked backwards).
  const impacted = new Set<number>(seeds);
  const queue = [...seeds];
  for (let head = 0; head < queue.length; head++) {
    for (const dependent of dependents.get(queue[head]!) ?? []) {
      if (!impacted.has(dependent)) {
        impacted.add(dependent);
        queue.push(dependent);
      }
    }
  }

  // Roll each impacted node up to the file and every group above it.
  const highlight = new Set<number>();
  for (const impactedPosition of impacted) {
    let current = impactedPosition;
    while (current !== -1) {
      const kind = data.kinds[current]!;
      if (kind === "file" || kind === "group") highlight.add(current);
      current = data.parents[current]!;
    }
  }

  // Ids are in code-unit order, so sorting positions sorts the ids.
  const ids = [...highlight].sort((a, b) => a - b).map((p) => data.ids[p]!);
  return { node: nodeId, count: ids.length, ids };
}
