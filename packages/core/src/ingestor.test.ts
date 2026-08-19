import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { ingest } from "./ingestor.js";
import {
  arbitraryDependencyGraph,
  arbitraryGraphWithDanglingEdge,
  arbitraryGraphWithDuplicateNode,
} from "./test-support/arbitraries.js";

// Feature: hierarchical-repository-grouping, Property 1: Ingestion preserves the exact node and edge sets
test("Property 1: ingestion preserves the exact node and edge sets (R1.1, R1.4)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const result = ingest(graph);
      assert.ok(result.ok, "valid graph must ingest");
      const model = result.value;

      const inputIds = new Set(graph.nodes.map((n) => n.id));
      const modelIds = new Set(model.nodes.map((n) => n.id));
      assert.deepEqual(modelIds, inputIds);
      assert.equal(model.nodes.length, graph.nodes.length);

      const edgeKey = (e: { source: string; target: string }) => `${e.source} -> ${e.target}`;
      assert.deepEqual(new Set(model.edges.map(edgeKey)), new Set(graph.edges.map(edgeKey)));
      assert.equal(model.edges.length, graph.edges.length);

      // Per-kind counts match (folded into set equality, asserted explicitly).
      for (const kind of ["file", "class", "function"] as const) {
        assert.equal(
          model.nodes.filter((n) => n.kind === kind).length,
          graph.nodes.filter((n) => n.kind === kind).length
        );
      }
      assert.equal(model.graph.order, graph.nodes.length);
      assert.equal(model.graph.size, graph.edges.length);
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 2: Ingestion rejects dangling edges atomically
test("Property 2: dangling edges are rejected naming the missing id (R1.2)", () => {
  fc.assert(
    fc.property(arbitraryGraphWithDanglingEdge(), ({ graph, missingId }) => {
      const result = ingest(graph);
      assert.ok(!result.ok, "graph with dangling edge must be rejected");
      assert.equal(result.error.code, "DANGLING_EDGE");
      assert.ok("nodeId" in result.error && result.error.nodeId === missingId);
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 3: Ingestion rejects duplicate node identifiers
test("Property 3: duplicate node ids are rejected naming the duplicated id (R1.5)", () => {
  fc.assert(
    fc.property(arbitraryGraphWithDuplicateNode(), ({ graph, duplicatedId }) => {
      const result = ingest(graph);
      assert.ok(!result.ok, "graph with duplicated node id must be rejected");
      assert.equal(result.error.code, "DUPLICATE_NODE");
      assert.ok("nodeId" in result.error && result.error.nodeId === duplicatedId);
    }),
    { numRuns: 100 }
  );
});

test("null and undefined inputs are rejected with NO_GRAPH (R1.6)", () => {
  for (const input of [null, undefined]) {
    const result = ingest(input);
    assert.ok(!result.ok);
    assert.equal(result.error.code, "NO_GRAPH");
  }
});

test("a zero-node graph is rejected with EMPTY_GRAPH (R1.3)", () => {
  const result = ingest({ nodes: [], edges: [] });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "EMPTY_GRAPH");
});

test("the definedInFile contract invariant is validated at the gate (extends R1 structural validation)", () => {
  const file = { id: "file:F.java", kind: "file" as const, directoryPath: "" };
  const edgeless: never[] = [];

  // Missing definedInFile on a class node.
  const missing = ingest({
    nodes: [file, { id: "class:C", kind: "class", directoryPath: "" }],
    edges: edgeless,
  });
  assert.ok(!missing.ok);
  assert.equal(missing.error.code, "INVALID_DEFINED_IN_FILE");
  assert.ok("nodeId" in missing.error && missing.error.nodeId === "class:C");

  // Dangling definedInFile.
  const dangling = ingest({
    nodes: [file, { id: "func:f()", kind: "function", directoryPath: "", definedInFile: "file:Ghost.java" }],
    edges: edgeless,
  });
  assert.ok(!dangling.ok);
  assert.equal(dangling.error.code, "INVALID_DEFINED_IN_FILE");

  // definedInFile pointing at a non-file node.
  const nonFile = ingest({
    nodes: [
      file,
      { id: "class:C1", kind: "class", directoryPath: "", definedInFile: "file:F.java" },
      { id: "class:C2", kind: "class", directoryPath: "", definedInFile: "class:C1" },
    ],
    edges: edgeless,
  });
  assert.ok(!nonFile.ok);
  assert.equal(nonFile.error.code, "INVALID_DEFINED_IN_FILE");
  assert.ok("nodeId" in nonFile.error && nonFile.error.nodeId === "class:C2");

  // A well-formed chain still ingests.
  const valid = ingest({
    nodes: [file, { id: "class:C1", kind: "class", directoryPath: "", definedInFile: "file:F.java" }],
    edges: edgeless,
  });
  assert.ok(valid.ok);
});
