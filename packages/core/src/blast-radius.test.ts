import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import type { NodeId, RawDependencyGraph } from "@repohive/shared";
import { analyzeBlastRadius } from "./blast-radius.js";
import { groupGraph } from "./orchestrator.js";
import { arbitraryDependencyGraph } from "./test-support/arbitraries.js";
import type { Hierarchy, HierarchyNode } from "./types.js";

function hierarchyOf(graph: RawDependencyGraph): Hierarchy {
  const result = groupGraph(graph);
  assert.ok(result.ok, "valid graph must group");
  return result.value.hierarchy;
}

/**
 * Independent recompute of the impact set: fixed-point iteration over the
 * reversed leaf edges — the target plus every node with a dependency path
 * reaching it, each node added at most once.
 */
function expectedImpactSet(hierarchy: Hierarchy, target: string): Set<string> {
  const impacted = new Set([target]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of hierarchy.leafEdges) {
      if (impacted.has(edge.target) && !impacted.has(edge.source)) {
        impacted.add(edge.source);
        changed = true;
      }
    }
  }
  return impacted;
}

/** Independent recompute: every group-kind ancestor of any impacted node. */
function expectedGroupAncestors(hierarchy: Hierarchy, impacted: Set<string>): string[] {
  const groups = new Set<string>();
  for (const id of impacted) {
    let current = hierarchy.nodes.get(id);
    while (current && current.parentId !== null) {
      const parent = hierarchy.nodes.get(current.parentId);
      if (parent?.kind === "group") {
        groups.add(parent.id);
      }
      current = parent;
    }
  }
  return [...groups].sort();
}

// Feature: hierarchical-repository-grouping, Property 32: Blast radius equals the reverse-reachable set, with containing groups
test("Property 32: blast radius equals the reverse-reachable set, with containing groups (R10.1, R10.2, R10.5, R10.6)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), fc.nat(1000), (graph, pick) => {
      const hierarchy = hierarchyOf(graph);

      // Prefer leaf-edge endpoints (interesting traversals); fall back to any
      // hierarchy node when the graph has no edges.
      const endpoints = [...new Set(hierarchy.leafEdges.flatMap((e) => [e.source, e.target]))].sort();
      const candidates = endpoints.length > 0 ? endpoints : [...hierarchy.nodes.keys()].sort();
      const target = candidates[pick % candidates.length]!;

      const result = analyzeBlastRadius(hierarchy, target);
      assert.ok(result.ok, "existing node must analyze");

      const impacted = expectedImpactSet(hierarchy, target);
      assert.deepEqual(result.value.nodes, [...impacted].sort());
      assert.deepEqual(result.value.groupNodes, expectedGroupAncestors(hierarchy, impacted));

      // R10.5: a node with no incoming leaf edges impacts only itself.
      if (hierarchy.leafEdges.every((e) => e.target !== target)) {
        assert.deepEqual(result.value.nodes, [target]);
      }
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 33: Blast radius traversal terminates and is deterministic
test("Property 33: blast radius traversal terminates and is deterministic (R10.7, R10.8)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), fc.nat(1000), (graph, pick) => {
      const hierarchy = hierarchyOf(graph);
      const candidates = [...hierarchy.nodes.keys()].sort();
      const target = candidates[pick % candidates.length]!;

      const first = analyzeBlastRadius(hierarchy, target);
      const second = analyzeBlastRadius(hierarchy, target);
      assert.ok(first.ok, "existing node must analyze");
      assert.ok(second.ok, "repeated query must analyze");

      // Cycle-safe visitation: each node and group appears at most once.
      assert.equal(new Set(first.value.nodes).size, first.value.nodes.length);
      assert.equal(new Set(first.value.groupNodes).size, first.value.groupNodes.length);

      // Repeated queries on an unchanged hierarchy return identical arrays.
      assert.deepEqual(second.value.nodes, first.value.nodes);
      assert.deepEqual(second.value.groupNodes, first.value.groupNodes);
    }),
    { numRuns: 100 }
  );
});

const CYCLE_DIRECTORY = "src/com/cycle";
const CYCLE_SIGNALS = { importFrequency: 1, methodCallFrequency: 1, sharedTypeCount: 0 };
const CYCLE_A = "file:src/com/cycle/A.java";
const CYCLE_B = "file:src/com/cycle/B.java";
const CYCLE_C = "file:src/com/cycle/C.java";

/** Explicit 3-cycle A → B → C → A of files in one package (R10.7). */
const threeCycleGraph: RawDependencyGraph = {
  nodes: [
    { id: CYCLE_A, kind: "file", packagePath: "com.cycle", directoryPath: CYCLE_DIRECTORY },
    { id: CYCLE_B, kind: "file", packagePath: "com.cycle", directoryPath: CYCLE_DIRECTORY },
    { id: CYCLE_C, kind: "file", packagePath: "com.cycle", directoryPath: CYCLE_DIRECTORY },
  ],
  edges: [
    { source: CYCLE_A, target: CYCLE_B, ...CYCLE_SIGNALS },
    { source: CYCLE_B, target: CYCLE_C, ...CYCLE_SIGNALS },
    { source: CYCLE_C, target: CYCLE_A, ...CYCLE_SIGNALS },
  ],
};

test("an explicit 3-cycle terminates with each node included exactly once (R10.7, R10.8)", () => {
  const hierarchy = hierarchyOf(threeCycleGraph);
  const allThree = [CYCLE_A, CYCLE_B, CYCLE_C].sort();

  for (const target of [CYCLE_A, CYCLE_B, CYCLE_C]) {
    const first = analyzeBlastRadius(hierarchy, target);
    const second = analyzeBlastRadius(hierarchy, target);
    assert.ok(first.ok);
    assert.ok(second.ok);

    // Every node of the cycle reaches every other: the full cycle, once each.
    assert.deepEqual(first.value.nodes, allThree);
    assert.deepEqual(second.value.nodes, first.value.nodes);
    assert.deepEqual(second.value.groupNodes, first.value.groupNodes);
  }
});

test("empty, null, and undefined node ids are rejected with EMPTY_NODE_ID (R10.4)", () => {
  const hierarchy = hierarchyOf(threeCycleGraph);
  for (const input of ["", null, undefined]) {
    const result = analyzeBlastRadius(hierarchy, input);
    assert.ok(!result.ok, "empty node id must be rejected");
    assert.equal(result.error.code, "EMPTY_NODE_ID");
  }
});

test("an unknown id is rejected with NODE_NOT_FOUND naming it, hierarchy unchanged (R10.3)", () => {
  const hierarchy = hierarchyOf(threeCycleGraph);
  const nodeCountBefore = hierarchy.nodes.size;

  const ghostId = "file:src/com/cycle/Ghost.java";
  const result = analyzeBlastRadius(hierarchy, ghostId);
  assert.ok(!result.ok, "unknown node id must be rejected");
  assert.equal(result.error.code, "NODE_NOT_FOUND");
  assert.ok("nodeId" in result.error && result.error.nodeId === ghostId);

  assert.equal(hierarchy.nodes.size, nodeCountBefore);
});

// --- The ancestor climb must terminate on cyclic containment (Gap 11) ------
//
// The dependency traversal always had a visited set; the containment climb did
// not, because a Hierarchy was assumed to be a tree. analyzeBlastRadius is
// public API over a plain Hierarchy value, so a caller — or a future
// incremental path that patches a hierarchy in memory — can hand it a cycle.

/** A Hierarchy whose parentId links form a cycle. parseIndex would reject it. */
function cyclicHierarchy(): Hierarchy {
  const nodes = new Map<NodeId, HierarchyNode>([
    ["g_a", { id: "g_a", kind: "group", level: 1, parentId: "g_b", childIds: ["g_b"] }],
    ["g_b", { id: "g_b", kind: "group", level: 2, parentId: "g_a", childIds: ["file:A.java"] }],
    [
      "file:A.java",
      { id: "file:A.java", kind: "file", level: 3, parentId: "g_b", childIds: [] },
    ],
  ]);
  return {
    repositoryId: "g_a",
    nodes,
    leafAttributes: new Map(),
    leafEdges: [],
    crossGroupEdges: [],
    depth: 3,
  };
}

test("a containment cycle terminates the climb instead of hanging (R10.7)", () => {
  const hierarchy = cyclicHierarchy();

  // Completion is the assertion. Relying on the runner's timeout would let a
  // regression reintroduce the hang and merely look slow.
  const first = analyzeBlastRadius(hierarchy, "file:A.java");
  assert.ok(first.ok, "a cyclic hierarchy must still yield a result");

  // Deterministic across repeated queries on an unchanged hierarchy (R10.8).
  const second = analyzeBlastRadius(hierarchy, "file:A.java");
  assert.ok(second.ok);
  assert.deepEqual(second.value, first.value);

  // The groups on the cycle are still reported — the guard stops the loop, it
  // does not truncate the answer.
  assert.deepEqual(first.value.groupNodes, ["g_a", "g_b"]);
});

test("a self-parenting node terminates the climb", () => {
  const nodes = new Map<NodeId, HierarchyNode>([
    ["g_self", { id: "g_self", kind: "group", level: 1, parentId: "g_self", childIds: [] }],
  ]);
  const hierarchy: Hierarchy = {
    repositoryId: "g_self",
    nodes,
    leafAttributes: new Map(),
    leafEdges: [],
    crossGroupEdges: [],
    depth: 1,
  };
  const result = analyzeBlastRadius(hierarchy, "g_self");
  assert.ok(result.ok);
});
