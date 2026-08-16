import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import type { RawDependencyGraph } from "@repohive/shared";
import { ingest } from "./ingestor.js";
import { computeWeights } from "./weights.js";
import { arbitraryDependencyGraph } from "./test-support/arbitraries.js";
import type { DependencyModel } from "./types.js";

function ingestOk(graph: RawDependencyGraph): DependencyModel {
  const result = ingest(graph);
  assert.ok(result.ok, "valid graph must ingest");
  return result.value;
}

const edgeKey = (e: { source: string; target: string }) => `${e.source} -> ${e.target}`;

// Feature: hierarchical-repository-grouping, Property 4: Every edge gets exactly one finite, non-negative strength
test("Property 4: every edge gets exactly one finite, non-negative strength (R2.1, R2.3)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const model = ingestOk(graph);
      const weighted = computeWeights(model);

      // Exactly one weighted entry per input edge INSTANCE — parallel
      // (source, target) edges are legal input, so count per key must match
      // the input's multiset, not be globally unique.
      assert.equal(weighted.weightedEdges.length, model.edges.length);
      const countByKey = new Map<string, number>();
      for (const edge of weighted.weightedEdges) {
        countByKey.set(edgeKey(edge), (countByKey.get(edgeKey(edge)) ?? 0) + 1);
      }
      const inputCountByKey = new Map<string, number>();
      for (const edge of model.edges) {
        inputCountByKey.set(edgeKey(edge), (inputCountByKey.get(edgeKey(edge)) ?? 0) + 1);
      }
      assert.deepEqual(countByKey, inputCountByKey);

      // Every strength is a finite, non-negative number.
      for (const edge of weighted.weightedEdges) {
        assert.ok(Number.isFinite(edge.strength), `strength of ${edgeKey(edge)} must be finite`);
        assert.ok(edge.strength >= 0, `strength of ${edgeKey(edge)} must be >= 0`);
      }
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 5: All-zero signals yield zero strength
test("Property 5: all-zero signals yield exactly zero strength (R2.5)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const zeroed: RawDependencyGraph = {
        nodes: graph.nodes,
        edges: graph.edges.map((edge) => ({
          ...edge,
          importFrequency: 0,
          methodCallFrequency: 0,
          sharedTypeCount: 0,
        })),
      };
      const weighted = computeWeights(ingestOk(zeroed));
      assert.equal(weighted.weightedEdges.length, zeroed.edges.length);
      for (const edge of weighted.weightedEdges) {
        assert.equal(edge.strength, 0, `all-zero signals on ${edgeKey(edge)} must give strength 0`);
      }
    }),
    { numRuns: 100 }
  );
});

const arbitrarySignalTriple = fc.record({
  importFrequency: fc.nat(5),
  methodCallFrequency: fc.nat(5),
  sharedTypeCount: fc.nat(5),
});

// Feature: hierarchical-repository-grouping, Property 6: Default weighting is componentwise monotonic
test("Property 6: default weighting is componentwise monotonic (R2.4)", () => {
  fc.assert(
    fc.property(arbitrarySignalTriple, arbitrarySignalTriple, (lower, delta) => {
      // higher >= lower in every component by construction.
      const higher = {
        importFrequency: lower.importFrequency + delta.importFrequency,
        methodCallFrequency: lower.methodCallFrequency + delta.methodCallFrequency,
        sharedTypeCount: lower.sharedTypeCount + delta.sharedTypeCount,
      };
      const fileA = "file:A.java";
      const fileB = "file:B.java";
      const graph: RawDependencyGraph = {
        nodes: [
          { id: fileA, kind: "file", directoryPath: "" },
          { id: fileB, kind: "file", directoryPath: "" },
        ],
        edges: [
          { source: fileA, target: fileB, ...higher },
          { source: fileB, target: fileA, ...lower },
        ],
      };
      const weighted = computeWeights(ingestOk(graph));
      const strengthOf = (source: string) =>
        weighted.weightedEdges.find((e) => e.source === source)!.strength;
      assert.ok(
        strengthOf(fileA) >= strengthOf(fileB),
        "componentwise-larger signals must not yield a smaller strength"
      );
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 7: Weight computation is deterministic
test("Property 7: weight computation is deterministic (R2.6)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const model = ingestOk(graph);
      const first = computeWeights(model);
      const second = computeWeights(model);
      const strengths = (weighted: typeof first) =>
        weighted.weightedEdges.map((e) => ({ source: e.source, target: e.target, strength: e.strength }));
      assert.deepEqual(strengths(second), strengths(first));
    }),
    { numRuns: 100 }
  );
});
