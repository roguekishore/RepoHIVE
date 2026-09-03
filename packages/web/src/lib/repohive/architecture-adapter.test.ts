import { describe, expect, it } from "vitest";
import type { Hierarchy, HierarchyNode, Metadata } from "@repohive/core";
import {
  adaptDeterminism,
  adaptGroupDsm,
  adaptLevelFlow,
  chooseDsmLevel,
} from "./architecture-adapter";

/**
 * Two regions, each split into two groups at level 2, plus a region-less
 * wrapper at level 1 — the shape that makes the block ordering testable:
 *
 *   r
 *   ├─ g_wrap (level 1, no region)
 *   │   ├─ g_a0 (pkg:a ord 0) ── file:a0
 *   │   ├─ g_a1 (pkg:a ord 1) ── file:a1
 *   │   ├─ g_b0 (pkg:b ord 0) ── file:b0
 *   │   └─ g_b1 (pkg:b ord 1) ── file:b1
 */

function node(
  partial: Partial<HierarchyNode> & { id: string; kind: HierarchyNode["kind"] },
): HierarchyNode {
  return { level: 0, parentId: null, childIds: [], ...partial };
}

function buildHierarchy(): Hierarchy {
  const groups = [
    { id: "g_a0", region: "pkg:a", ordinal: 0, file: "file:a0" },
    { id: "g_a1", region: "pkg:a", ordinal: 1, file: "file:a1" },
    { id: "g_b0", region: "pkg:b", ordinal: 0, file: "file:b0" },
    { id: "g_b1", region: "pkg:b", ordinal: 1, file: "file:b1" },
  ];
  const list: HierarchyNode[] = [
    node({ id: "r", kind: "repository", level: 0, childIds: ["g_wrap"] }),
    node({
      id: "g_wrap",
      kind: "group",
      level: 1,
      parentId: "r",
      childIds: groups.map((g) => g.id).sort(),
    }),
    ...groups.map((g) =>
      node({
        id: g.id,
        kind: "group" as const,
        level: 2,
        parentId: "g_wrap",
        childIds: [g.file],
        regionId: g.region,
        ordinal: g.ordinal,
      }),
    ),
    ...groups.map((g) => node({ id: g.file, kind: "file" as const, level: 3, parentId: g.id })),
  ];
  return {
    repositoryId: "r",
    nodes: new Map(list.map((n) => [n.id, n])),
    leafAttributes: new Map() as unknown as Hierarchy["leafAttributes"],
    leafEdges: [],
    // a0 → a1 inside pkg:a (an in-block dependency), a1 → b0 across regions.
    crossGroupEdges: [
      { source: "g_a0", target: "g_a1", level: 2, weight: 5 },
      { source: "g_a1", target: "g_b0", level: 2, weight: 2 },
    ],
    depth: 3,
  };
}

function buildMetadata(): Metadata {
  return {
    structuralQualityBoundary: 0.5,
    metricWeights: { cohesion: 0.4, coupling: 0.4 },
    cohesionSquashConstant: 1,
    regionDecisions: [
      {
        regionId: "pkg:a",
        cohesion: 2,
        coupling: 0.3,
        score: 0.62,
        action: "preserve",
        automaticAction: "preserve",
        userOverridden: false,
        decisionConfidence: 0.12,
      },
      {
        regionId: "pkg:b",
        cohesion: 0,
        coupling: 1,
        score: 0,
        action: "reconstruct",
        automaticAction: "reconstruct",
        userOverridden: false,
        decisionConfidence: 0.5,
      },
    ],
    nodeCount: 10,
    edgeCount: 2,
    hierarchyDepth: 3,
    perLevel: [
      { level: 0, groupNodeCount: 1, leafNodeCount: 0, crossGroupEdgeCount: 0, leafEdgeCount: 0 },
      { level: 1, groupNodeCount: 1, leafNodeCount: 0, crossGroupEdgeCount: 0, leafEdgeCount: 0 },
      { level: 2, groupNodeCount: 4, leafNodeCount: 0, crossGroupEdgeCount: 2, leafEdgeCount: 0 },
      { level: 3, groupNodeCount: 0, leafNodeCount: 4, crossGroupEdgeCount: 0, leafEdgeCount: 2 },
    ],
    totalCrossGroupEdges: 2,
    averageBranchingFactor: 2,
    configuration: {
      structuralQualityBoundary: 0.5,
      communityDetectionSeed: 42,
      weightCoefficients: { importCoefficient: 1, callCoefficient: 1, sharedTypeCoefficient: 1 },
      assessment: {
        weights: { cohesion: 0.4, coupling: 0.4 },
        computeModularity: false,
        cohesionSquashConstant: 1,
        degenerateScore: 0,
      },
      hierarchy: { maxGroupSize: 20, minPartitionThreshold: 2 },
      overrides: {},
    } as Metadata["configuration"],
  } as Metadata;
}

describe("chooseDsmLevel", () => {
  it("prefers a level whose groups carry recorded regions", () => {
    // Level 1 has a group too, but it is a region-less wrapper — a matrix over
    // it would have no blocks at all.
    expect(chooseDsmLevel(buildHierarchy(), buildMetadata())).toBe(2);
  });
});

describe("adaptGroupDsm", () => {
  it("orders the axis by recorded region then ordinal, forming diagonal blocks", () => {
    const dsm = adaptGroupDsm(buildHierarchy(), buildMetadata());
    expect(dsm.groups.map((g) => g.id)).toEqual(["g_a0", "g_a1", "g_b0", "g_b1"]);
    expect(dsm.blocks.map((b) => [b.regionId, b.start, b.size])).toEqual([
      ["pkg:a", 0, 2],
      ["pkg:b", 2, 2],
    ]);
  });

  it("places each recorded weight at the row/column of its endpoints", () => {
    const dsm = adaptGroupDsm(buildHierarchy(), buildMetadata());
    expect(dsm.entries).toEqual([
      { from: 0, to: 1, weight: 5 }, // g_a0 → g_a1, inside the pkg:a block
      { from: 1, to: 2, weight: 2 }, // g_a1 → g_b0, crossing regions
    ]);
    expect(dsm.maxWeight).toBe(5);
  });

  it("carries the recorded decision state onto each group, degenerate included", () => {
    const dsm = adaptGroupDsm(buildHierarchy(), buildMetadata());
    const byId = new Map(dsm.groups.map((g) => [g.id, g]));
    expect(byId.get("g_a0")!.state).toBe("preserve");
    // pkg:b is score 0 with cohesion 0 — assigned by rule, not measured.
    expect(byId.get("g_b0")!.state).toBe("degenerate");
  });

  it("sums recorded in and out weight per group", () => {
    const dsm = adaptGroupDsm(buildHierarchy(), buildMetadata());
    const byId = new Map(dsm.groups.map((g) => [g.id, g]));
    expect(byId.get("g_a1")!.inWeight).toBe(5);
    expect(byId.get("g_a1")!.outWeight).toBe(2);
    expect(byId.get("g_b1")!.inWeight).toBe(0);
  });

  it("admits whole regions under the budget so blocks survive the cut", () => {
    // Budget 2 fits exactly one of the two 2-group regions. Slicing by
    // most-connected group would have taken g_a0 and g_a1 from one region and
    // left a half-region; admitting whole regions keeps the block intact.
    const dsm = adaptGroupDsm(buildHierarchy(), buildMetadata(), 2, 2);
    expect(dsm.groups).toHaveLength(2);
    expect(new Set(dsm.groups.map((g) => g.regionId)).size).toBe(1);
    expect(dsm.omittedGroups).toBe(2);
    expect(dsm.totalGroups).toBe(4);
    // And it reports the dependencies it could not draw.
    expect(dsm.totalEdges).toBe(2);
    expect(dsm.shownEdges).toBeLessThan(dsm.totalEdges);
  });

  it("is deterministic: identical input yields deep-equal output", () => {
    expect(adaptGroupDsm(buildHierarchy(), buildMetadata())).toEqual(
      adaptGroupDsm(buildHierarchy(), buildMetadata()),
    );
  });
});

describe("adaptLevelFlow", () => {
  it("passes perLevel through in level order, unmodified", () => {
    expect(adaptLevelFlow(buildMetadata())).toEqual(buildMetadata().perLevel);
  });
});

describe("adaptDeterminism", () => {
  it("reports distinct ids against the group count, so a collision would show", () => {
    const evidence = adaptDeterminism(buildHierarchy(), buildMetadata());
    expect(evidence.totalGroups).toBe(5); // four region groups + the wrapper
    expect(evidence.distinctIds).toBe(5);
  });

  it("samples real groups with the canonical membership the id hashes over", () => {
    const evidence = adaptDeterminism(buildHierarchy(), buildMetadata(), 2);
    expect(evidence.samples).toHaveLength(2);
    // The wrapper has the most members, so it leads the sample.
    expect(evidence.samples[0]!.id).toBe("g_wrap");
    expect(evidence.samples[0]!.memberCount).toBe(4);
    expect(evidence.samples[0]!.members).toEqual(["g_a0", "g_a1", "g_b0", "g_b1"]);
  });

  it("surfaces the recorded configuration and seed", () => {
    const evidence = adaptDeterminism(buildHierarchy(), buildMetadata());
    expect(evidence.seed).toBe(42);
    expect(evidence.configuration?.hierarchy?.maxGroupSize).toBe(20);
    expect(evidence.repositoryId).toBe("r");
  });

  it("reports an absent configuration rather than inventing one", () => {
    const metadata = { ...buildMetadata() };
    delete (metadata as { configuration?: unknown }).configuration;
    const evidence = adaptDeterminism(buildHierarchy(), metadata as Metadata);
    expect(evidence.configuration).toBeNull();
    expect(evidence.seed).toBeNull();
  });
});
