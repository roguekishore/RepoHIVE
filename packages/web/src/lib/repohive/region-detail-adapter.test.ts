import { describe, expect, it } from "vitest";
import type { Hierarchy, HierarchyNode, Metadata } from "@repohive/core";
import {
  adaptRegionDetail,
  regionFileMembership,
  stripRegionScheme,
} from "./region-detail-adapter";

/**
 * Synthetic index shaped like the real one: a repository root, a region split
 * into two recorded groups (with ordinals), a fan-out wrapper carrying no
 * region, and class-level leaf edges that must be lifted to files.
 *
 *   r
 *   ├─ g_wrap (no regionId)
 *   │   ├─ g_a0 (pkg:a, ordinal 0) ── file:a/Zero.java
 *   │   └─ g_a1 (pkg:a, ordinal 1) ── file:a/One.java, file:a/Two.java
 *   └─ g_b (pkg:b, ordinal 0)      ── file:b/B.java
 */

function node(partial: Partial<HierarchyNode> & { id: string; kind: HierarchyNode["kind"] }): HierarchyNode {
  return { level: 0, parentId: null, childIds: [], ...partial };
}

function buildHierarchy(): Hierarchy {
  const list: HierarchyNode[] = [
    node({ id: "r", kind: "repository", level: 0, childIds: ["g_b", "g_wrap"] }),
    node({ id: "g_wrap", kind: "group", level: 1, parentId: "r", childIds: ["g_a0", "g_a1"] }),
    node({ id: "g_a0", kind: "group", level: 2, parentId: "g_wrap", childIds: ["file:a/Zero.java"], regionId: "pkg:a", ordinal: 0 }),
    node({ id: "g_a1", kind: "group", level: 2, parentId: "g_wrap", childIds: ["file:a/One.java", "file:a/Two.java"], regionId: "pkg:a", ordinal: 1 }),
    node({ id: "g_b", kind: "group", level: 1, parentId: "r", childIds: ["file:b/B.java"], regionId: "pkg:b", ordinal: 0 }),
    node({ id: "file:a/Zero.java", kind: "file", level: 3, parentId: "g_a0" }),
    node({ id: "file:a/One.java", kind: "file", level: 3, parentId: "g_a1", childIds: ["class:a|One"] }),
    node({ id: "file:a/Two.java", kind: "file", level: 3, parentId: "g_a1", childIds: ["class:a|Two"] }),
    node({ id: "file:b/B.java", kind: "file", level: 2, parentId: "g_b", childIds: ["class:b|B"] }),
    node({ id: "class:a|One", kind: "class", level: 4, parentId: "file:a/One.java" }),
    node({ id: "class:a|Two", kind: "class", level: 4, parentId: "file:a/Two.java" }),
    node({ id: "class:b|B", kind: "class", level: 3, parentId: "file:b/B.java" }),
  ];
  const leafAttributes = new Map(
    [
      ["file:a/Zero.java", { id: "file:a/Zero.java", kind: "file", packagePath: "com.a", directoryPath: "a" }],
      ["file:a/One.java", { id: "file:a/One.java", kind: "file", packagePath: "com.a", directoryPath: "a" }],
      ["file:a/Two.java", { id: "file:a/Two.java", kind: "file", packagePath: "com.a", directoryPath: "a" }],
      ["file:b/B.java", { id: "file:b/B.java", kind: "file", packagePath: "com.b", directoryPath: "b" }],
    ] as const,
  );
  return {
    repositoryId: "r",
    nodes: new Map(list.map((n) => [n.id, n])),
    leafAttributes: leafAttributes as unknown as Hierarchy["leafAttributes"],
    leafEdges: [
      // Class-level, both inside pkg:a — must lift to files and aggregate.
      { source: "class:a|One", target: "class:a|Two", importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0, strength: 2 },
      { source: "class:a|Two", target: "class:a|One", importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0, strength: 3 },
      // Crosses regions — excluded from pkg:a's detail.
      { source: "file:a/Two.java", target: "file:b/B.java", importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0, strength: 1 },
    ],
    crossGroupEdges: [],
    depth: 4,
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
        cohesion: 1.25,
        coupling: 0.4,
        score: 0.58,
        action: "reconstruct",
        automaticAction: "reconstruct",
        userOverridden: false,
        decisionConfidence: 0.08,
        groupIds: ["g_a0", "g_a1"],
      },
      {
        regionId: "pkg:b",
        cohesion: 0,
        coupling: 1,
        score: 0,
        action: "preserve",
        automaticAction: "preserve",
        userOverridden: false,
        decisionConfidence: 0.5,
        groupIds: ["g_b"],
      },
    ],
    nodeCount: 12,
    edgeCount: 3,
    hierarchyDepth: 4,
    perLevel: [],
    totalCrossGroupEdges: 0,
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

describe("regionFileMembership", () => {
  it("assigns each file the region of its nearest regioned ancestor, skipping wrappers", () => {
    const membership = regionFileMembership(buildHierarchy());
    expect([...membership.keys()].sort()).toEqual(["pkg:a", "pkg:b"]);
    expect(membership.get("pkg:a")).toEqual([
      "file:a/One.java",
      "file:a/Two.java",
      "file:a/Zero.java",
    ]);
    expect(membership.get("pkg:b")).toEqual(["file:b/B.java"]);
  });
});

describe("adaptRegionDetail", () => {
  it("returns null for a region the engine did not record", () => {
    expect(adaptRegionDetail(buildHierarchy(), buildMetadata(), "pkg:nope")).toBeNull();
  });

  it("joins files, partitions and lifted edges for a reconstructed region", () => {
    const detail = adaptRegionDetail(buildHierarchy(), buildMetadata(), "pkg:a")!;
    expect(detail.displayName).toBe("a");
    expect(detail.seed).toBe(42);
    expect(detail.truncatedFiles).toBe(0);
    expect(detail.files.map((f) => f.name)).toEqual(["One.java", "Two.java", "Zero.java"]);

    // Authored: one packagePath cell holding every member file.
    expect(detail.authored).toEqual([
      {
        id: "pkg:com.a",
        label: "com.a",
        fileIds: ["file:a/One.java", "file:a/Two.java", "file:a/Zero.java"],
      },
    ]);

    // Derived: the recorded groups, ordinal order, reconstruct wording.
    expect(detail.derived.map((c) => ({ id: c.id, label: c.label }))).toEqual([
      { id: "g_a0", label: "cluster 1 of 2" },
      { id: "g_a1", label: "cluster 2 of 2" },
    ]);
    expect(detail.derived[1]!.fileIds).toEqual(["file:a/One.java", "file:a/Two.java"]);

    // Class-level edges lifted to files, aggregated undirected (2 + 3), and
    // the cross-region edge excluded.
    expect(detail.edges).toEqual([
      { source: "file:a/One.java", target: "file:a/Two.java", strength: 5 },
    ]);
  });

  it("labels a single-cell region with its scheme-stripped name", () => {
    const detail = adaptRegionDetail(buildHierarchy(), buildMetadata(), "pkg:b")!;
    expect(detail.derived).toEqual([
      { id: "g_b", label: "b", fileIds: ["file:b/B.java"] },
    ]);
  });

  it("caps files deterministically by connectedness with an honest count", () => {
    const detail = adaptRegionDetail(buildHierarchy(), buildMetadata(), "pkg:a", 2)!;
    // Zero.java has no edges, so it is the file dropped.
    expect(detail.truncatedFiles).toBe(1);
    expect(detail.files.map((f) => f.id)).toEqual(["file:a/One.java", "file:a/Two.java"]);
    expect(detail.edges).toHaveLength(1);
  });

  it("is deterministic: identical input yields deep-equal output", () => {
    const a = adaptRegionDetail(buildHierarchy(), buildMetadata(), "pkg:a");
    const b = adaptRegionDetail(buildHierarchy(), buildMetadata(), "pkg:a");
    expect(a).toEqual(b);
  });
});

describe("stripRegionScheme", () => {
  it("drops the scheme prefix only", () => {
    expect(stripRegionScheme("pkg:com.example")).toBe("com.example");
    expect(stripRegionScheme("no-scheme")).toBe("no-scheme");
  });
});
