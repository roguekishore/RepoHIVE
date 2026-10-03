/**
 * Normalises the engine's in-memory grouping output to what `parseIndex`
 * returns for the written index, so a view built from one equals the view built
 * from the other.
 *
 * The known differences: the in-memory hierarchy may carry the optional
 * `groupIdsOfRegion`, which `parseIndex` does not return, and its maps iterate
 * in construction order, whereas `parseIndex` builds them in the index's
 * canonical order (nodes by id, leaf attributes in node order, leaf edges by
 * source and target). The adapter drops what `parseIndex` drops and orders the
 * maps as `parseIndex` does, and writes `metadata` with sorted keys as the index does. If the equality test disagrees, fix this function;
 * never loosen the test.
 */
import { sortByIds, sortEdges } from "@repohive/core";
import type { GroupingOutput, Hierarchy, Metadata } from "@repohive/core";

/** The shape every view takes: what `parseIndex` returns on success. */
export interface ViewIndex {
  hierarchy: Hierarchy;
  metadata: Metadata;
}

/**
 * `value` with object keys sorted at every depth, arrays left in order: the key
 * order `metadata.json` is written and read back in. Values `JSON.stringify`
 * would drop (`undefined`) stay as they are.
 */
function withSortedKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(withSortedKeys) as T;
  }
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      sorted[key] = withSortedKeys((value as Record<string, unknown>)[key]);
    }
    return sorted as T;
  }
  return value;
}

export function fromGroupingOutput(output: GroupingOutput): ViewIndex {
  const source = output.hierarchy;
  const sorted = sortByIds([...source.nodes.values()]);

  const nodes: Hierarchy["nodes"] = new Map();
  const leafAttributes: Hierarchy["leafAttributes"] = new Map();
  for (const node of sorted) {
    nodes.set(node.id, node);
    const attributes = source.leafAttributes.get(node.id);
    if (attributes !== undefined) {
      leafAttributes.set(node.id, attributes);
    }
  }

  const hierarchy: Hierarchy = {
    repositoryId: source.repositoryId,
    nodes,
    leafAttributes,
    leafEdges: sortEdges(source.leafEdges),
    crossGroupEdges: source.crossGroupEdges,
    depth: source.depth,
  };
  return { hierarchy, metadata: withSortedKeys(output.metadata) };
}
