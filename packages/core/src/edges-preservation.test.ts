import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import type { DependencyEdge, NodeId, RawDependencyGraph } from "@repohive/shared";
import { groupGraph } from "./orchestrator.js";
import { DEFAULT_WEIGHT_COEFFICIENTS } from "./weights.js";
import type { CrossGroupEdge, Hierarchy, HierarchyNode } from "./types.js";
import { arbitraryDependencyGraph } from "./test-support/arbitraries.js";

const edgeKey = (source: string, target: string) => JSON.stringify([source, target]);

/** Root→node id chain following parentId links (index 0 = repository). */
function rootToNodeChain(id: NodeId, nodes: Map<NodeId, HierarchyNode>): NodeId[] {
  const chain: NodeId[] = [];
  let current = nodes.get(id);
  while (current) {
    chain.push(current.id);
    current = current.parentId === null ? undefined : nodes.get(current.parentId);
  }
  return chain.reverse();
}

/**
 * Independent recomputation of the expected Cross_Group_Edges (R8.2–R8.4):
 * for each leaf edge, walk the two root→leaf ancestor chains in lockstep;
 * at each shared depth where the ids differ and BOTH nodes are group-kind,
 * accumulate the edge's strength into the (sourceAncestor, targetAncestor)
 * pair; stop at the first diverged depth where either node is not a group.
 */
function expectedCrossGroupEdges(hierarchy: Hierarchy): CrossGroupEdge[] {
  const aggregated = new Map<string, CrossGroupEdge>();
  for (const edge of hierarchy.leafEdges) {
    const sourceChain = rootToNodeChain(edge.source, hierarchy.nodes);
    const targetChain = rootToNodeChain(edge.target, hierarchy.nodes);
    const depths = Math.min(sourceChain.length, targetChain.length);
    for (let i = 0; i < depths; i++) {
      const sourceAncestor = sourceChain[i]!;
      const targetAncestor = targetChain[i]!;
      if (sourceAncestor === targetAncestor) {
        continue;
      }
      const sourceNode = hierarchy.nodes.get(sourceAncestor)!;
      const targetNode = hierarchy.nodes.get(targetAncestor)!;
      if (sourceNode.kind !== "group" || targetNode.kind !== "group") {
        break;
      }
      const key = edgeKey(sourceAncestor, targetAncestor);
      const existing = aggregated.get(key);
      if (existing) {
        existing.weight += edge.strength;
      } else {
        aggregated.set(key, {
          source: sourceAncestor,
          target: targetAncestor,
          level: i,
          weight: edge.strength,
        });
      }
    }
  }
  return [...aggregated.values()];
}

function sortedCrossGroupEdges(edges: readonly CrossGroupEdge[]): CrossGroupEdge[] {
  return [...edges].sort((a, b) => {
    const key = edgeKey(a.source, a.target);
    const other = edgeKey(b.source, b.target);
    return key < other ? -1 : key > other ? 1 : 0;
  });
}

/** Ordered reachable pairs "start -> reached" via BFS from every node. */
function reachablePairs(
  nodeIds: readonly NodeId[],
  edges: ReadonlyArray<Pick<DependencyEdge, "source" | "target">>
): Set<string> {
  const adjacency = new Map<NodeId, NodeId[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.source);
    if (list) {
      list.push(edge.target);
    } else {
      adjacency.set(edge.source, [edge.target]);
    }
  }
  const pairs = new Set<string>();
  for (const start of nodeIds) {
    const visited = new Set<NodeId>([start]);
    const queue: NodeId[] = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
          pairs.add(`${start} -> ${next}`);
        }
      }
    }
  }
  return pairs;
}

// Feature: hierarchical-repository-grouping, Property 26: All leaf edges are retained with direction and strength
test("Property 26: all leaf edges are retained with direction and strength (R8.1)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const result = groupGraph(graph);
      assert.ok(result.ok, "valid graph must group");
      const { hierarchy } = result.value;

      // Exactly one leaf edge per input edge — multiset semantics, so
      // parallel (source, target) edges with different content count too.
      assert.equal(hierarchy.leafEdges.length, graph.edges.length);

      const { importCoefficient: a, callCoefficient: b, sharedTypeCoefficient: c } =
        DEFAULT_WEIGHT_COEFFICIENTS;
      const tuple = (e: {
        source: string;
        target: string;
        importFrequency: number;
        methodCallFrequency: number;
        sharedTypeCount: number;
      }) => JSON.stringify([e.source, e.target, e.importFrequency, e.methodCallFrequency, e.sharedTypeCount]);
      const expected = graph.edges
        .map((e) => ({
          key: tuple(e),
          strength: a * e.importFrequency + b * e.methodCallFrequency + c * e.sharedTypeCount,
        }))
        .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
      const actual = hierarchy.leafEdges
        .map((e) => ({ key: tuple(e), strength: e.strength }))
        .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
      for (let i = 0; i < expected.length; i++) {
        assert.equal(actual[i]!.key, expected[i]!.key, "leaf edge multiset must equal the input edge multiset");
        assert.ok(
          Math.abs(actual[i]!.strength - expected[i]!.strength) < 1e-9,
          `strength ${actual[i]!.strength} must equal weighted signals ${expected[i]!.strength}`
        );
      }
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 27: Cross-group edges are correctly placed and weighted
test("Property 27: cross-group edges are correctly placed and weighted (R8.2, R8.3, R8.4)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const result = groupGraph(graph);
      assert.ok(result.ok, "valid graph must group");
      const { hierarchy } = result.value;

      // Structural invariants of every produced Cross_Group_Edge.
      for (const cge of hierarchy.crossGroupEdges) {
        assert.notEqual(cge.source, cge.target, "a CGE must never connect a node to itself");
        const sourceNode = hierarchy.nodes.get(cge.source);
        const targetNode = hierarchy.nodes.get(cge.target);
        assert.ok(sourceNode !== undefined && targetNode !== undefined);
        assert.equal(sourceNode.kind, "group", "CGE source must be a Group_Node");
        assert.equal(targetNode.kind, "group", "CGE target must be a Group_Node");
        assert.equal(sourceNode.level, targetNode.level, "CGE endpoints must sit at the same level");
        assert.equal(cge.level, sourceNode.level);
      }

      // Multiset equality against the independent recomputation.
      const expected = sortedCrossGroupEdges(expectedCrossGroupEdges(hierarchy));
      const actual = sortedCrossGroupEdges(hierarchy.crossGroupEdges);
      assert.equal(actual.length, expected.length, "CGE count must match the recomputation");
      for (let i = 0; i < expected.length; i++) {
        const want = expected[i]!;
        const got = actual[i]!;
        assert.equal(got.source, want.source);
        assert.equal(got.target, want.target);
        assert.equal(got.level, want.level);
        assert.ok(
          Math.abs(got.weight - want.weight) < 1e-9,
          `CGE ${got.source} -> ${got.target} weight ${got.weight} must equal ${want.weight}`
        );
      }
    }),
    { numRuns: 100 }
  );
});

test("cross-group edges match a hand-computed expectation, at every diverged group level (R8.2, R8.4)", () => {
  // Two preserve-forced packages, so the tree shape is fully known:
  // repo → L1_a → L2_a → {A1, A2} and repo → L1_b → L2_b → {B1, B2}.
  // Edges: A1→B1 (strength 3), A2→B1 (strength 2), B2→A1 (strength 1).
  // Expected (hand-computed from the INPUT, not from the tree walk):
  //   level 1: L1_a→L1_b weight 5, L1_b→L1_a weight 1
  //   level 2: L2_a→L2_b weight 5, L2_b→L2_a weight 1
  const file = (name: string): string => `file:src/com/${name}.java`;
  const node = (name: string, pkg: string) => ({
    id: file(name),
    kind: "file" as const,
    packagePath: pkg,
    directoryPath: `src/com/${pkg.split(".")[1]}`,
  });
  const edge = (from: string, to: string, importFrequency: number) => ({
    source: file(from),
    target: file(to),
    importFrequency,
    methodCallFrequency: 0,
    sharedTypeCount: 0,
  });
  const graph: RawDependencyGraph = {
    nodes: [node("a/A1", "com.a"), node("a/A2", "com.a"), node("b/B1", "com.b"), node("b/B2", "com.b")],
    edges: [edge("a/A1", "b/B1", 3), edge("a/A2", "b/B1", 2), edge("b/B2", "a/A1", 1)],
  };
  const result = groupGraph(graph, { structuralQualityBoundary: 0 });
  assert.ok(result.ok);
  const { hierarchy } = result.value;

  // Resolve the group ids from the leaf parents (content-addressed, so not
  // hard-codable), then assert the exact expected CGE set.
  const parentOf = (id: string): string => {
    const parent = hierarchy.nodes.get(id)?.parentId;
    assert.ok(parent, `${id} must have a parent`);
    return parent;
  };
  const l2a = parentOf(file("a/A1"));
  const l2b = parentOf(file("b/B1"));
  const l1a = parentOf(l2a);
  const l1b = parentOf(l2b);
  assert.equal(parentOf(file("a/A2")), l2a);
  assert.equal(parentOf(file("b/B2")), l2b);

  const actual = sortedCrossGroupEdges(hierarchy.crossGroupEdges);
  const expected = sortedCrossGroupEdges([
    { source: l1a, target: l1b, level: 1, weight: 5 },
    { source: l1b, target: l1a, level: 1, weight: 1 },
    { source: l2a, target: l2b, level: 2, weight: 5 },
    { source: l2b, target: l2a, level: 2, weight: 1 },
  ]);
  assert.deepEqual(actual, expected);
});

test("leaves sharing their immediate parent contribute no CGE at that level (R8.3)", () => {
  // Two files in one package → one Region; boundary 0 forces preserve, so the
  // Region stays a single group and the endpoints share every group ancestor.
  const graph: RawDependencyGraph = {
    nodes: [
      { id: "file:src/com/alpha/A.java", kind: "file", packagePath: "com.alpha", directoryPath: "src/com/alpha" },
      { id: "file:src/com/alpha/B.java", kind: "file", packagePath: "com.alpha", directoryPath: "src/com/alpha" },
    ],
    edges: [
      {
        source: "file:src/com/alpha/A.java",
        target: "file:src/com/alpha/B.java",
        importFrequency: 2,
        methodCallFrequency: 1,
        sharedTypeCount: 0,
      },
    ],
  };
  const result = groupGraph(graph, { structuralQualityBoundary: 0 });
  assert.ok(result.ok);
  const { hierarchy } = result.value;

  // Both files share an immediate parent group.
  const a = hierarchy.nodes.get("file:src/com/alpha/A.java");
  const b = hierarchy.nodes.get("file:src/com/alpha/B.java");
  assert.ok(a !== undefined && b !== undefined);
  assert.equal(a.parentId, b.parentId);

  // The dependency is preserved as a leaf edge, but no CGE arises anywhere.
  assert.equal(hierarchy.leafEdges.length, 1);
  assert.deepEqual(hierarchy.crossGroupEdges, []);
});

// Feature: hierarchical-repository-grouping, Property 28: Leaf-to-leaf reachability is preserved
test("Property 28: leaf-to-leaf reachability is preserved (R8.5)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const result = groupGraph(graph);
      assert.ok(result.ok, "valid graph must group");
      const { hierarchy } = result.value;

      const nodeIds = graph.nodes.map((n) => n.id);
      const inputReachability = reachablePairs(nodeIds, graph.edges);
      const hierarchyReachability = reachablePairs(nodeIds, hierarchy.leafEdges);
      assert.deepEqual(hierarchyReachability, inputReachability);
    }),
    { numRuns: 100 }
  );
});
