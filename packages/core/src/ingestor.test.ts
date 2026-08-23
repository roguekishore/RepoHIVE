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

// --- Field validity at the ingest gate (Gap 13) ---------------------------
//
// `graph.json` is untrusted disk input. The contract's doc comments assert
// these invariants ("Unique, non-empty", "Non-negative integer") but nothing
// enforced them, so wrongly-typed fields were silently coerced: `"5"` became
// strength 5 and a fractional `2.5` passed a field documented as an integer.

/** A minimal conforming graph, with `patch` applied to exercise one defect. */
function graphWith(patch: {
  nodes?: unknown[];
  edges?: unknown[];
}): Parameters<typeof ingest>[0] {
  return {
    nodes: patch.nodes ?? [
      { id: "file:A.java", kind: "file", directoryPath: "" },
      { id: "file:B.java", kind: "file", directoryPath: "" },
    ],
    edges: patch.edges ?? [],
  } as Parameters<typeof ingest>[0];
}

/** A well-formed edge, with one field overridden. */
function edgeWith(overrides: Record<string, unknown>): unknown {
  return {
    source: "file:A.java",
    target: "file:B.java",
    importFrequency: 1,
    methodCallFrequency: 0,
    sharedTypeCount: 0,
    ...overrides,
  };
}

test("malformed node shapes are rejected naming the node and the field (R1.7)", () => {
  const cases: ReadonlyArray<readonly [string, unknown[], string]> = [
    ["null element", [null], "not an object"],
    ["undefined element", [undefined], "not an object"],
    ["non-object element", ["file:A.java"], "not an object"],
    ["empty-string id", [{ id: "", kind: "file", directoryPath: "" }], "non-empty string"],
    ["missing id", [{ kind: "file", directoryPath: "" }], "non-empty string"],
    ["numeric id", [{ id: 7, kind: "file", directoryPath: "" }], "non-empty string"],
    ["unknown kind", [{ id: "n", kind: "module", directoryPath: "" }], "unknown kind"],
    ["missing kind", [{ id: "n", directoryPath: "" }], "unknown kind"],
    ["missing directoryPath", [{ id: "n", kind: "file" }], "directoryPath"],
    ["non-string directoryPath", [{ id: "n", kind: "file", directoryPath: 0 }], "directoryPath"],
    [
      "non-string packagePath",
      [{ id: "n", kind: "file", directoryPath: "", packagePath: 1 }],
      "packagePath",
    ],
    [
      "file node carrying definedInFile",
      [{ id: "n", kind: "file", directoryPath: "", definedInFile: "n" }],
      "must omit definedInFile",
    ],
  ];

  for (const [label, nodes, expectedDetail] of cases) {
    const result = ingest(graphWith({ nodes }));
    assert.ok(!result.ok, `${label} must be rejected`);
    assert.equal(result.error.code, "MALFORMED_NODE", label);
    assert.ok("detail" in result.error && result.error.detail.includes(expectedDetail), label);
    // No partial model: the failure is a value, and it carries no graph.
    assert.ok(!("value" in result), label);
  }
});

test("malformed edge shapes and signal values are rejected naming the pair (R1.7)", () => {
  const cases: ReadonlyArray<readonly [string, unknown, string]> = [
    ["null element", null, "not an object"],
    ["undefined element", undefined, "not an object"],
    ["non-object element", "a->b", "not an object"],
    ["non-string source", edgeWith({ source: 1 }), "must be strings"],
    ["missing target", edgeWith({ target: undefined }), "must be strings"],
    ["string signal", edgeWith({ importFrequency: "5" }), "importFrequency"],
    ["fractional signal", edgeWith({ methodCallFrequency: 2.5 }), "methodCallFrequency"],
    ["negative signal", edgeWith({ sharedTypeCount: -1 }), "sharedTypeCount"],
    ["NaN signal", edgeWith({ importFrequency: Number.NaN }), "importFrequency"],
    ["Infinity signal", edgeWith({ importFrequency: Number.POSITIVE_INFINITY }), "importFrequency"],
    ["missing signal", edgeWith({ sharedTypeCount: undefined }), "sharedTypeCount"],
    ["null signal", edgeWith({ sharedTypeCount: null }), "sharedTypeCount"],
    ["boolean signal", edgeWith({ methodCallFrequency: true }), "methodCallFrequency"],
    ["negative strength", edgeWith({ strength: -0.5 }), "strength"],
    ["NaN strength", edgeWith({ strength: Number.NaN }), "strength"],
    ["Infinity strength", edgeWith({ strength: Number.POSITIVE_INFINITY }), "strength"],
    ["string strength", edgeWith({ strength: "1" }), "strength"],
  ];

  for (const [label, edge, expectedDetail] of cases) {
    const result = ingest(graphWith({ edges: [edge] }));
    assert.ok(!result.ok, `${label} must be rejected`);
    assert.equal(result.error.code, "MALFORMED_EDGE", label);
    assert.ok("detail" in result.error && result.error.detail.includes(expectedDetail), label);
    assert.ok(!("value" in result), label);
  }
});

test("conforming optional fields are still accepted", () => {
  // The risk of a validation fix is over-strictness; these are all legal.
  const result = ingest(
    graphWith({
      nodes: [
        { id: "file:A.java", kind: "file", directoryPath: "", packagePath: "com.x" },
        { id: "file:B.java", kind: "file", directoryPath: "sub" },
        { id: "class:C", kind: "class", directoryPath: "", definedInFile: "file:A.java" },
      ],
      edges: [edgeWith({ strength: 0 }), edgeWith({ importFrequency: 0, target: "class:C" })],
    }),
  );
  assert.ok(result.ok, "conforming graph must ingest");
});

// Feature: hierarchical-repository-grouping, Property 36: Field validation never rejects a conforming graph
test("Property 36: the field gate accepts every conforming graph unchanged (R1.7)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const result = ingest(graph);
      assert.ok(result.ok, "the gate must not reject conforming input");
      assert.equal(result.value.nodes.length, graph.nodes.length);
      assert.equal(result.value.edges.length, graph.edges.length);
    }),
    { numRuns: 100 },
  );
});
