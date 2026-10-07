import type { ViewBodies } from "../../contracts";
import type { Region } from "./regions";

/**
 * Small recorded views for the tests of this folder: a few regions with known scores, so what a screen shows can be
 * checked against what was recorded. The values are made up for the tests and say nothing about any repository.
 */
export function region(partial: Partial<Region> & Pick<Region, "regionId" | "score" | "cohesion" | "coupling" | "action">): Region {
  return {
    displayName: partial.regionId.replace(/^pkg:/, ""),
    automaticAction: partial.action,
    userOverridden: false,
    decisionConfidence: 0.5,
    fileCount: 10,
    groupIds: ["g_a", "g_b"],
    ...partial,
  };
}

export const REGIONS: readonly Region[] = [
  region({ regionId: "pkg:app.core", score: 0.62, cohesion: 1.1, coupling: 0.3, action: "preserve", fileCount: 120 }),
  region({ regionId: "pkg:app.web", score: 0.48, cohesion: 0.8, coupling: 0.5, action: "reconstruct", fileCount: 90 }),
  region({ regionId: "pkg:app.data", score: 0.51, cohesion: 0.9, coupling: 0.4, action: "preserve", fileCount: 60 }),
  region({ regionId: "pkg:app.util", score: 0.2, cohesion: 0.2, coupling: 0.7, action: "reconstruct", fileCount: 30 }),
  region({ regionId: "pkg:app.tiny", score: 0, cohesion: 0, coupling: 1, action: "reconstruct", fileCount: 1, groupIds: ["g_c"] }),
  region({ regionId: "pkg:app.edge", score: 1, cohesion: 5, coupling: 0, action: "preserve", fileCount: 5 }),
];

export function regionDecisions(regions: readonly Region[] = REGIONS): ViewBodies["regionDecisions"] {
  return {
    boundary: 0.5,
    metricWeights: { cohesion: 0.4, coupling: 0.4 },
    cohesionSquashConstant: 1,
    seed: 42,
    regionCount: regions.length,
    regions: [...regions],
  };
}

export function adaptivity(id = "acme/widgets", extra: readonly ViewBodies["adaptivity"]["repos"][number][] = []): ViewBodies["adaptivity"] {
  const repo: ViewBodies["adaptivity"]["repos"][number] = {
    id,
    name: id.split("/")[1] ?? id,
    files: 1234,
    nodes: 20000,
    edges: 15000,
    depth: 6,
    regions: 6,
    assessed: 5,
    preserved: 3,
    reconstructed: 2,
    degenerate: 1,
    preserveShare: 0.6,
    config: { boundary: 0.5, weights: { cohesion: 0.4, coupling: 0.4 }, squashK: 1, seed: 42, maxGroupSize: 20, minPartitionThreshold: 2 },
    assessedScores: [0.2, 0.48, 0.51, 0.62, 1],
  };
  return { repos: [repo, ...extra], sameConfiguration: true, configurationNote: null, skipped: [] };
}

export function hierarchyScale(): ViewBodies["hierarchyScale"] {
  return {
    arcs: [],
    maxLevel: 4,
    totalFiles: 1234,
    levels: [
      { level: 0, groupNodeCount: 1, leafNodeCount: 0, crossGroupEdgeCount: 0, leafEdgeCount: 0 },
      { level: 1, groupNodeCount: 10, leafNodeCount: 0, crossGroupEdgeCount: 4, leafEdgeCount: 0 },
      { level: 2, groupNodeCount: 0, leafNodeCount: 1000, crossGroupEdgeCount: 0, leafEdgeCount: 500 },
    ],
    omittedArcs: 0,
    totalNodes: 1011,
    counts: { preserve: 3, reconstruct: 2, degenerate: 1, none: 0 },
  };
}
