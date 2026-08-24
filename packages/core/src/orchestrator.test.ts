import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import type { RawDependencyGraph } from "@repohive/shared";
import {
  DEFAULT_GROUPING_CONFIG,
  groupGraph,
  groupGraphToIndex,
  resolveConfig,
} from "./orchestrator.js";

const graph: RawDependencyGraph = {
  nodes: [
    { id: "file:src/com/a/A1.java", kind: "file", packagePath: "com.a", directoryPath: "src/com/a" },
    { id: "file:src/com/a/A2.java", kind: "file", packagePath: "com.a", directoryPath: "src/com/a" },
    { id: "file:src/com/b/B1.java", kind: "file", packagePath: "com.b", directoryPath: "src/com/b" },
  ],
  edges: [
    {
      source: "file:src/com/a/A1.java",
      target: "file:src/com/a/A2.java",
      importFrequency: 4,
      methodCallFrequency: 0,
      sharedTypeCount: 0,
    },
    {
      source: "file:src/com/a/A1.java",
      target: "file:src/com/b/B1.java",
      importFrequency: 1,
      methodCallFrequency: 0,
      sharedTypeCount: 0,
    },
  ],
};

test("resolveConfig never lets an explicitly-undefined option clobber a default", () => {
  // A natural CLI-plumbing pattern: optional flags forwarded as undefined.
  const resolved = resolveConfig({
    structuralQualityBoundary: undefined,
    communityDetectionSeed: undefined,
    assessment: { cohesionSquashConstant: undefined, weights: { cohesion: undefined } },
    hierarchy: { maxGroupSize: undefined },
    weightCoefficients: { importCoefficient: undefined },
  });
  assert.deepEqual(resolved, DEFAULT_GROUPING_CONFIG);
});

test("groupGraph output with explicitly-undefined options equals the default-config output", () => {
  const withDefaults = groupGraph(graph);
  const withUndefined = groupGraph(graph, {
    assessment: { cohesionSquashConstant: undefined },
    hierarchy: { maxGroupSize: undefined },
  });
  assert.ok(withDefaults.ok && withUndefined.ok);

  // Same scores and decisions — no NaN-poisoned metric path.
  assert.deepEqual(withUndefined.value.metadata.regionDecisions, withDefaults.value.metadata.regionDecisions);
  assert.equal(
    withUndefined.value.metadata.cohesionSquashConstant,
    withDefaults.value.metadata.cohesionSquashConstant
  );
  for (const decision of withUndefined.value.metadata.regionDecisions) {
    assert.ok(Number.isFinite(decision.score));
  }
});

// --- No exception escapes a public entry point (Fix 2 — Gap 3) -------------
//
// Both packages promise errors-as-values, but reachable paths threw: a `null`
// element in an untrusted graph.json raised a TypeError straight out of
// `ingest`. A thrown error crosses every boundary uncaught and takes the run
// with it, so the promise has to be total, not merely usual.

/** Inputs no producer should emit — the space a boundary must survive. */
const arbitraryHostileGraph = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant({} as never),
  fc.constant({ nodes: null, edges: null } as never),
  fc.constant({ nodes: [null], edges: [] } as never),
  fc.constant({ nodes: [{ id: "a", kind: "file", directoryPath: "" }], edges: [null] } as never),
  fc.constant({ nodes: [1, "x", true], edges: [] } as never),
  fc.record({
    nodes: fc.array(fc.oneof(fc.constant(null), fc.anything()), { maxLength: 4 }),
    edges: fc.array(fc.oneof(fc.constant(null), fc.anything()), { maxLength: 4 }),
  }) as fc.Arbitrary<never>,
);

// Feature: hierarchical-repository-grouping, Property 38: No exception escapes a public entry point
test("Property 38: groupGraph returns a Result for hostile input and never throws (R12.1)", () => {
  fc.assert(
    fc.property(arbitraryHostileGraph, (input) => {
      let result: ReturnType<typeof groupGraph> | undefined;
      assert.doesNotThrow(() => {
        result = groupGraph(input);
      });
      assert.ok(result !== undefined);
      // Every rejection is a value carrying a code, never a bare crash.
      if (!result.ok) {
        assert.equal(typeof result.error.code, "string");
      }
    }),
    { numRuns: 100 },
  );
});

test("a collaborator that throws becomes INTERNAL_ERROR, not a crash", () => {
  const exploding = {
    detect(): never {
      throw new Error("detector exploded");
    },
  };
  const graph = {
    nodes: [
      { id: "file:a/A.java", kind: "file" as const, directoryPath: "a", packagePath: "a" },
      { id: "file:a/B.java", kind: "file" as const, directoryPath: "a", packagePath: "a" },
    ],
    edges: [
      {
        source: "file:a/A.java",
        target: "file:a/B.java",
        importFrequency: 3,
        methodCallFrequency: 0,
        sharedTypeCount: 0,
      },
    ],
  };

  let result: ReturnType<typeof groupGraph> | undefined;
  assert.doesNotThrow(() => {
    result = groupGraph(graph, { structuralQualityBoundary: 1.000001 }, exploding);
  });
  assert.ok(result !== undefined && !result.ok);
  assert.equal(result.error.code, "INTERNAL_ERROR");
  assert.ok("detail" in result.error && result.error.detail.includes("detector exploded"));
});

test("groupGraphToIndex converts a serializer failure into a value, writing nothing", () => {
  const graph = {
    nodes: [{ id: "file:A.java", kind: "file" as const, directoryPath: "" }],
    edges: [],
  };
  // A path that cannot be a directory: the write fails inside the serializer.
  let result: ReturnType<typeof groupGraphToIndex> | undefined;
  assert.doesNotThrow(() => {
    result = groupGraphToIndex(graph, "\0invalid");
  });
  assert.ok(result !== undefined && !result.ok);
  assert.ok(["WRITE_FAILED", "INTERNAL_ERROR"].includes(result.error.code));
});
