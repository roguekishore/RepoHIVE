import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawDependencyGraph } from "@repohive/shared";
import { DEFAULT_GROUPING_CONFIG, groupGraph, resolveConfig } from "./orchestrator.js";

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
