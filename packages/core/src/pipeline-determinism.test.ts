import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { stableStringify } from "./canonical.js";
import { INDEX_FILE_NAMES, indexFilePayloads, type IndexFileName } from "./index-serializer.js";
import { groupGraph, type GroupingOutput } from "./orchestrator.js";
import { arbitraryDependencyGraph, shuffleGraph } from "./test-support/arbitraries.js";

/** Project a pipeline output onto its five serialized index-file bodies. */
function serializedFiles(output: GroupingOutput): Record<IndexFileName, string> {
  const payloads = indexFilePayloads(output.hierarchy, output.metadata);
  const files = {} as Record<IndexFileName, string>;
  for (const name of INDEX_FILE_NAMES) {
    files[name] = stableStringify(payloads[name]);
  }
  return files;
}

// Feature: hierarchical-repository-grouping, Property 24: Full-build determinism
test("Property 24: two full builds on the same input serialize byte-identically (R7.1)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const first = groupGraph(graph);
      const second = groupGraph(graph);
      assert.ok(first.ok, "valid graph must group (first run)");
      assert.ok(second.ok, "valid graph must group (second run)");

      // Structural checks first — redundant with byte equality below, but
      // they localize a failure to node ids or depth instead of a byte diff.
      assert.deepEqual(
        new Set(second.value.hierarchy.nodes.keys()),
        new Set(first.value.hierarchy.nodes.keys())
      );
      assert.equal(second.value.hierarchy.depth, first.value.hierarchy.depth);

      const firstFiles = serializedFiles(first.value);
      const secondFiles = serializedFiles(second.value);
      for (const name of INDEX_FILE_NAMES) {
        assert.equal(secondFiles[name], firstFiles[name], `${name} must be byte-identical across runs`);
      }
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 25: Order-independence of input
test("Property 25: shuffled input yields byte-identical index files (R7.2)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), fc.nat(), (graph, seed) => {
      const original = groupGraph(graph);
      const shuffled = groupGraph(shuffleGraph(graph, seed));
      assert.ok(original.ok, "valid graph must group");
      assert.ok(shuffled.ok, "shuffled graph must group");

      const originalFiles = serializedFiles(original.value);
      const shuffledFiles = serializedFiles(shuffled.value);
      for (const name of INDEX_FILE_NAMES) {
        assert.equal(
          shuffledFiles[name],
          originalFiles[name],
          `${name} must not depend on input node/edge order`
        );
      }
    }),
    { numRuns: 100 }
  );
});
