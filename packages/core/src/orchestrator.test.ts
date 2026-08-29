import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import type { RawDependencyGraph } from "@repohive/shared";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_GROUPING_CONFIG,
  groupGraph,
  groupGraphToIndex,
  resolveConfig,
  type PartialGroupingConfig,
} from "./orchestrator.js";
import { stableStringify } from "./canonical.js";
import { serializeIndex } from "./index-serializer.js";
import { parseIndex } from "./index-parser.js";
import { arbitraryDependencyGraph } from "./test-support/arbitraries.js";

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

// --- Configuration is validated before any work (Gap 9) -------------------
//
// Nothing checked these values. A NaN boundary made every `score > boundary`
// comparison false, so the run silently reconstructed every region — then wrote
// NaN into metadata.json, which JSON.stringify renders as null and the engine's
// own parseIndex rejects. The same missing gate sat behind negative
// coefficients, a non-positive squash constant, and a degenerateScore > 1.

/** A detector that fails the test if construction is ever reached. */
const forbiddenDetector = {
  detect(): never {
    throw new Error("community detection must not run when the config is invalid");
  },
};

const validGraph: RawDependencyGraph = {
  nodes: [
    { id: "file:p/A.java", kind: "file", packagePath: "p", directoryPath: "p" },
    { id: "file:p/B.java", kind: "file", packagePath: "p", directoryPath: "p" },
  ],
  edges: [
    {
      source: "file:p/A.java",
      target: "file:p/B.java",
      importFrequency: 3,
      methodCallFrequency: 0,
      sharedTypeCount: 0,
    },
  ],
};

test("every out-of-domain config field is rejected before ingest, naming the field", () => {
  const cases: ReadonlyArray<readonly [string, PartialGroupingConfig, string]> = [
    ["NaN boundary", { structuralQualityBoundary: Number.NaN }, "structuralQualityBoundary"],
    ["+Inf boundary", { structuralQualityBoundary: Number.POSITIVE_INFINITY }, "structuralQualityBoundary"],
    ["-Inf boundary", { structuralQualityBoundary: Number.NEGATIVE_INFINITY }, "structuralQualityBoundary"],
    ["fractional seed", { communityDetectionSeed: 1.5 }, "communityDetectionSeed"],
    ["NaN seed", { communityDetectionSeed: Number.NaN }, "communityDetectionSeed"],
    ["unsafe seed", { communityDetectionSeed: 2 ** 53 }, "communityDetectionSeed"],
    [
      "negative coefficient",
      { weightCoefficients: { importCoefficient: -1 } },
      "weightCoefficients.importCoefficient",
    ],
    [
      "NaN coefficient",
      { weightCoefficients: { callCoefficient: Number.NaN } },
      "weightCoefficients.callCoefficient",
    ],
    [
      "Infinite coefficient",
      { weightCoefficients: { sharedTypeCoefficient: Number.POSITIVE_INFINITY } },
      "weightCoefficients.sharedTypeCoefficient",
    ],
    [
      "negative metric weight",
      { assessment: { weights: { cohesion: -1 } } },
      "assessment.weights.cohesion",
    ],
    [
      "all-zero metric weights",
      { assessment: { weights: { cohesion: 0, coupling: 0 } } },
      "assessment.weights",
    ],
    ["squash constant 0", { assessment: { cohesionSquashConstant: 0 } }, "cohesionSquashConstant"],
    ["squash constant < 0", { assessment: { cohesionSquashConstant: -2 } }, "cohesionSquashConstant"],
    [
      "squash constant NaN",
      { assessment: { cohesionSquashConstant: Number.NaN } },
      "cohesionSquashConstant",
    ],
    ["degenerateScore > 1", { assessment: { degenerateScore: 7 } }, "degenerateScore"],
    ["degenerateScore < 0", { assessment: { degenerateScore: -0.5 } }, "degenerateScore"],
    ["degenerateScore NaN", { assessment: { degenerateScore: Number.NaN } }, "degenerateScore"],
    ["maxGroupSize out of bounds", { hierarchy: { maxGroupSize: 51 } }, "maxGroupSize"],
    ["fractional maxGroupSize", { hierarchy: { maxGroupSize: 10.5 } }, "maxGroupSize"],
    [
      "minPartitionThreshold above maxGroupSize",
      { hierarchy: { maxGroupSize: 5, minPartitionThreshold: 6 } },
      "minPartitionThreshold",
    ],
  ];

  for (const [label, partial, expectedField] of cases) {
    // The forbidden detector proves the gate runs *before* construction, not
    // merely that a bad config eventually fails somewhere.
    const result = groupGraph(validGraph, partial, forbiddenDetector);
    assert.ok(!result.ok, `${label} must be rejected`);
    assert.equal(result.error.code, "INVALID_CONFIG", label);
    assert.ok(
      "detail" in result.error && result.error.detail.includes(expectedField),
      `${label}: detail must name ${expectedField}, got ${JSON.stringify(result.error)}`,
    );
  }
});

test("a boundary outside [0,1] but finite stays legal — the all-reconstruct baseline", () => {
  // demo-baselines expresses "always reconstruct" as boundary 1.000001. Only
  // finiteness is required, so that keeps working.
  const result = groupGraph(validGraph, { structuralQualityBoundary: 1.000001 });
  assert.ok(result.ok, "a finite out-of-unit boundary must remain legal");
  assert.ok(result.value.metadata.regionDecisions.every((d) => d.action === "reconstruct"));

  const zero = groupGraph(validGraph, { structuralQualityBoundary: 0 });
  assert.ok(zero.ok);
});

test("a NaN boundary writes nothing at all, replacing the mixed-index failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "repohive-badconfig-"));
  try {
    const result = groupGraphToIndex(validGraph, dir, {
      structuralQualityBoundary: Number.NaN,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "INVALID_CONFIG");
    // Previously this wrote an index carrying `null` where NaN had been — one
    // that the engine's own parseIndex then rejected.
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stableStringify refuses non-finite numbers at any depth", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => stableStringify(bad), /non-finite/);
    assert.throws(() => stableStringify({ score: bad }), /non-finite/);
    assert.throws(() => stableStringify({ a: { b: [1, bad] } }), /non-finite/);
    assert.throws(() => stableStringify([{ deep: { deeper: bad } }]), /non-finite/);
  }
  // Finite numbers, including negative zero and exponents, still serialize.
  assert.equal(stableStringify(0), "0\n");
  assert.equal(stableStringify(-0), "0\n");
  assert.equal(stableStringify(1e21), "1e+21\n");
});

// Feature: hierarchical-repository-grouping, Property 42: Metadata numerics always round-trip
test("Property 42: metadata round-trips through serialize and parse for any valid config (R9.5)", () => {
  fc.assert(
    fc.property(
      arbitraryDependencyGraph({ maxFiles: 5, maxEdges: 8 }),
      fc.double({ min: -2, max: 2, noNaN: true }),
      fc.boolean(),
      (graph, boundary, computeModularity) => {
        const output = groupGraph(graph, {
          structuralQualityBoundary: boundary,
          assessment: { computeModularity },
        });
        assert.ok(output.ok, "a valid config must not be rejected");

        const dir = mkdtempSync(join(tmpdir(), "repohive-meta-rt-"));
        try {
          assert.ok(serializeIndex(output.value.hierarchy, output.value.metadata, dir).ok);
          const parsed = parseIndex(dir);
          assert.ok(parsed.ok, "metadata must round-trip");
          // `+ 0` normalizes -0: JSON has no negative zero, so the round trip
          // legitimately returns 0, and assert.equal follows Object.is.
          assert.equal(parsed.value.metadata.structuralQualityBoundary + 0, boundary + 0);
          assert.equal(
            parsed.value.metadata.regionDecisions.length,
            output.value.metadata.regionDecisions.length,
          );
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    ),
    { numRuns: 100 },
  );
});
