import { describe, expect, it } from "vitest";
import type { Hierarchy, HierarchyNode, Metadata } from "@repohive/core";
import { adaptHierarchyScale } from "./hierarchy-scale-adapter";

/**
 * Synthetic tree with the shapes that matter:
 *
 *   r
 *   ├─ g_wrap        (no regionId — a fan-out wrapper)
 *   │   └─ g_a       (pkg:a, reconstructed) → 3 files
 *   └─ g_b           (pkg:b, degenerate)    → 1 file
 */

function node(
  partial: Partial<HierarchyNode> & { id: string; kind: HierarchyNode["kind"] },
): HierarchyNode {
  return { level: 0, parentId: null, childIds: [], ...partial };
}

function buildHierarchy(fileCount = 3): Hierarchy {
  const aFiles = Array.from({ length: fileCount }, (_, i) => `file:a/F${i}.java`);
  const list: HierarchyNode[] = [
    node({ id: "r", kind: "repository", level: 0, childIds: ["g_b", "g_wrap"] }),
    node({ id: "g_wrap", kind: "group", level: 1, parentId: "r", childIds: ["g_a"] }),
    node({
      id: "g_a",
      kind: "group",
      level: 2,
      parentId: "g_wrap",
      childIds: aFiles,
      regionId: "pkg:a",
      ordinal: 0,
    }),
    node({
      id: "g_b",
      kind: "group",
      level: 1,
      parentId: "r",
      childIds: ["file:b/B.java"],
      regionId: "pkg:b",
      ordinal: 0,
    }),
    ...aFiles.map((id) => node({ id, kind: "file" as const, level: 3, parentId: "g_a" })),
    node({ id: "file:b/B.java", kind: "file", level: 2, parentId: "g_b" }),
  ];
  return {
    repositoryId: "r",
    nodes: new Map(list.map((n) => [n.id, n])),
    leafAttributes: new Map() as unknown as Hierarchy["leafAttributes"],
    leafEdges: [],
    crossGroupEdges: [],
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
        cohesion: 1.2,
        coupling: 0.9,
        score: 0.28,
        action: "reconstruct",
        automaticAction: "reconstruct",
        userOverridden: false,
        decisionConfidence: 0.22,
      },
      {
        // The degenerate signature: score 0 with cohesion 0.
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
    nodeCount: 8,
    edgeCount: 0,
    hierarchyDepth: 3,
    perLevel: [
      { level: 0, groupNodeCount: 1, leafNodeCount: 0, crossGroupEdgeCount: 0, leafEdgeCount: 0 },
      { level: 1, groupNodeCount: 2, leafNodeCount: 0, crossGroupEdgeCount: 0, leafEdgeCount: 0 },
    ],
    totalCrossGroupEdges: 0,
    averageBranchingFactor: 2,
  } as Metadata;
}

describe("adaptHierarchyScale", () => {
  it("allocates each ring's sweep in proportion to file count, filling the circle", () => {
    const scale = adaptHierarchyScale(buildHierarchy(3), buildMetadata());
    const level1 = scale.arcs.filter((a) => a.level === 1);
    expect(level1.reduce((sum, a) => sum + a.span, 0)).toBeCloseTo(1, 12);
    // g_wrap holds 3 of the 4 files, g_b holds 1.
    const wrap = level1.find((a) => a.id === "g_wrap")!;
    const b = level1.find((a) => a.id === "g_b")!;
    expect(wrap.span).toBeCloseTo(0.75, 12);
    expect(b.span).toBeCloseTo(0.25, 12);
  });

  it("never overlaps arcs within a ring", () => {
    const scale = adaptHierarchyScale(buildHierarchy(6), buildMetadata());
    for (const level of new Set(scale.arcs.map((a) => a.level))) {
      const ring = scale.arcs
        .filter((a) => a.level === level)
        .sort((x, y) => x.start - y.start);
      for (let i = 0; i < ring.length - 1; i++) {
        expect(ring[i]!.start + ring[i]!.span).toBeLessThanOrEqual(ring[i + 1]!.start + 1e-9);
      }
    }
  });

  it("inherits a recorded decision down to descendants", () => {
    const scale = adaptHierarchyScale(buildHierarchy(3), buildMetadata());
    const file = scale.arcs.find((a) => a.id === "file:a/F0.java")!;
    // The file carries no regionId of its own, but its region IS recorded.
    expect(file.regionId).toBe("pkg:a");
    expect(file.state).toBe("reconstruct");
    expect(file.wrapper).toBe(false);
  });

  it("marks a region-less group as a structural wrapper, not as an outcome", () => {
    const scale = adaptHierarchyScale(buildHierarchy(3), buildMetadata());
    const wrap = scale.arcs.find((a) => a.id === "g_wrap")!;
    expect(wrap.state).toBe("none");
    expect(wrap.wrapper).toBe(true);
    expect(wrap.regionId).toBeNull();
  });

  it("renders a rule-assigned region as degenerate, not as reconstruct", () => {
    const scale = adaptHierarchyScale(buildHierarchy(3), buildMetadata());
    expect(scale.arcs.find((a) => a.id === "g_b")!.state).toBe("degenerate");
    // And its file inherits that, rather than reading as a measured rebuild.
    expect(scale.arcs.find((a) => a.id === "file:b/B.java")!.state).toBe("degenerate");
  });

  it("omits sub-visible arcs and reports how many, rather than hiding them", () => {
    // 2000 files under one group: each file arc is 1/2001 turns, well under the
    // visibility floor, so they are dropped and counted.
    const scale = adaptHierarchyScale(buildHierarchy(2000), buildMetadata());
    expect(scale.omittedArcs).toBeGreaterThan(1900);
    expect(scale.arcs.some((a) => a.id.startsWith("file:a/"))).toBe(false);
    // The roll-up still counts every file, so the hub figure stays truthful.
    expect(scale.totalFiles).toBe(2001);
  });

  it("is deterministic: identical input yields deep-equal output", () => {
    const a = adaptHierarchyScale(buildHierarchy(5), buildMetadata());
    const b = adaptHierarchyScale(buildHierarchy(5), buildMetadata());
    expect(a).toEqual(b);
  });

  it("carries perLevel through untouched for the ring key", () => {
    const scale = adaptHierarchyScale(buildHierarchy(3), buildMetadata());
    expect(scale.levels).toEqual(buildMetadata().perLevel);
  });
});
