/**
 * The architecture view (`GET /api/graph/{id}/architecture`): the three
 * recorded structural artifacts (the per-level flow, the group-to-group DSM and
 * the determinism evidence) plus the levels a DSM can be asked for.
 *
 * `level` overrides the DSM's level; by default the adapter picks the deepest
 * level whose group count still fits the matrix budget.
 *
 * Moved from the route handler without behaviour change.
 */
import type { Hierarchy, Metadata } from "@repohive/core";
import { adaptDeterminism, adaptFragmentation, adaptGroupDsm, adaptLevelFlow } from "./architecture-adapter.js";

export function availableArchitectureLevels(metadata: Metadata): { level: number; groupNodeCount: number }[] {
  return metadata.perLevel
    .filter((row) => row.groupNodeCount > 1)
    .map((row) => ({ level: row.level, groupNodeCount: row.groupNodeCount }));
}

export function buildArchitectureView(hierarchy: Hierarchy, metadata: Metadata, level?: number) {
  return {
    levels: adaptLevelFlow(metadata),
    dsm: adaptGroupDsm(hierarchy, metadata, level),
    fragmentation: adaptFragmentation(hierarchy, metadata),
    determinism: adaptDeterminism(hierarchy, metadata),
    availableLevels: availableArchitectureLevels(metadata),
  };
}
