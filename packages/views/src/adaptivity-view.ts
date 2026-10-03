/**
 * The cross-repository comparison (`GET /api/adaptivity`).
 *
 * Not repo-scoped: the point is comparing repositories. The route reads every
 * registered fixture; a hosted snapshot compares just its own repository. A
 * repository that cannot be read is named in `skipped`, never silently dropped.
 *
 * Moved from the route handler without behaviour change.
 */
import type { Hierarchy } from "@repohive/core";
import { adaptAdaptivity, type AdaptivityInput } from "./adaptivity-adapter.js";

/** Number of `file` nodes: the comparison's size column. */
export function countFiles(hierarchy: Hierarchy): number {
  let files = 0;
  for (const node of hierarchy.nodes.values()) {
    if (node.kind === "file") files += 1;
  }
  return files;
}

export function buildAdaptivityView(inputs: readonly AdaptivityInput[], skipped: readonly string[]) {
  const comparison = adaptAdaptivity([...inputs]);
  return { ...comparison, skipped: [...skipped].sort() };
}
