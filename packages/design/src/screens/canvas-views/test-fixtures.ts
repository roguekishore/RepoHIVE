import type { ArchitectureBody, HierarchyScale } from "./view-types";

/** Two rings: a kept layer with two children (one kept, one rebuilt), a rebuilt layer, an unassessed layer, a wrapper. */
export const HIERARCHY: HierarchyScale = {
  maxLevel: 2,
  totalFiles: 100,
  totalNodes: 140,
  omittedArcs: 3,
  levels: [],
  counts: { preserve: 2, reconstruct: 2, degenerate: 1, none: 1 },
  arcs: [
    { id: "g_kept", level: 1, start: 0, span: 0.5, files: 50, state: "preserve", label: "core", regionId: "pkg:com.example.core", wrapper: false },
    { id: "g_rebuilt", level: 1, start: 0.5, span: 0.25, files: 25, state: "reconstruct", label: "web", regionId: "pkg:com.example.web", wrapper: false },
    { id: "g_unassessed", level: 1, start: 0.75, span: 0.15, files: 15, state: "degenerate", label: "", regionId: "pkg:com.example.util", wrapper: false },
    { id: "g_wrap", level: 1, start: 0.9, span: 0.1, files: 10, state: "none", label: "", regionId: null, wrapper: true },
    { id: "g_kept_a", level: 2, start: 0, span: 0.3, files: 30, state: "preserve", label: "", regionId: "pkg:com.example.core", wrapper: false },
    { id: "file:src/B.java", level: 2, start: 0.3, span: 0.2, files: 20, state: "reconstruct", label: "", regionId: "pkg:com.example.core", wrapper: false },
  ],
};

export const ARCHITECTURE: ArchitectureBody = {
  levels: [
    { level: 1, groupNodeCount: 4, leafNodeCount: 100, crossGroupEdgeCount: 0, leafEdgeCount: 300 },
    { level: 2, groupNodeCount: 6, leafNodeCount: 100, crossGroupEdgeCount: 40, leafEdgeCount: 300 },
  ],
  dsm: {
    groups: [
      { id: "g_a", label: "alpha", regionId: "pkg:a", state: "preserve", level: 2, files: 10, outWeight: 3, inWeight: 9 },
      { id: "g_b", label: "beta", regionId: "pkg:a", state: "preserve", level: 2, files: 12, outWeight: 9, inWeight: 3 },
      { id: "g_c", label: "gamma", regionId: "pkg:b", state: "reconstruct", level: 2, files: 5, outWeight: 1, inWeight: 1 },
    ],
    entries: [
      { from: 0, to: 1, weight: 3 },
      { from: 1, to: 0, weight: 9 },
      { from: 2, to: 0, weight: 1 },
    ],
    blocks: [
      { regionId: "pkg:a", label: "a", start: 0, size: 2, state: "preserve" },
      { regionId: "pkg:b", label: "b", start: 2, size: 1, state: "reconstruct" },
    ],
    maxWeight: 9,
    totalGroups: 5,
    omittedGroups: 2,
    shownEdges: 3,
    totalEdges: 7,
    level: 2,
  },
  fragmentation: {
    regions: [{ regionId: "pkg:b", label: "b", files: 40, groupCount: 3, groupSizes: [20, 12, 8], largestShare: 0.5, score: 0.2 }],
    totalReconstructed: 1,
    omittedRegions: 0,
    maxSplit: 3,
  },
  determinism: {
    scheme: "g_<sha1( json(sorted member ids) )>",
    repositoryId: "r_0123456789abcdef0123456789abcdef01234567",
    samples: [{ id: "g_fedcba9876543210fedcba9876543210fedcba98", regionId: "pkg:a", memberCount: 12, members: ["x"] }],
    totalGroups: 5,
    configuration: null,
    seed: 42,
    distinctIds: 5,
  },
  availableLevels: [{ level: 2, groupNodeCount: 6 }],
};
