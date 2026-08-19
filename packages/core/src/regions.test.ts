import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import type { GraphNode } from "@repohive/shared";
import { ingest } from "./ingestor.js";
import { assignRegions, owningFileOf, primaryRegionOfFile } from "./regions.js";
import { arbitraryDependencyGraph } from "./test-support/arbitraries.js";

// Feature: hierarchical-repository-grouping, Property 8: Primary_Region assignment is a total partition over File nodes
test("Property 8: Primary_Region assignment is a total partition over File nodes (R3.1, R3.2)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const result = ingest(graph);
      assert.ok(result.ok, "valid graph must ingest");
      const model = result.value;

      const { members, primaryRegionOf } = assignRegions(model);

      const fileIds = new Set(model.nodes.filter((n) => n.kind === "file").map((n) => n.id));
      const nonFileIds = model.nodes.filter((n) => n.kind !== "file").map((n) => n.id);

      // Every File node appears in primaryRegionOf exactly once (Map keys are
      // unique, so key-set equality plus size gives exactly-once).
      assert.deepEqual(new Set(primaryRegionOf.keys()), fileIds);
      assert.equal(primaryRegionOf.size, fileIds.size);

      // Non-file nodes are never assigned a Primary_Region.
      for (const id of nonFileIds) {
        assert.ok(!primaryRegionOf.has(id), `non-file node ${id} must not have a Primary_Region`);
      }

      // The union of members lists equals the File-node id set, and no id
      // appears in two regions (total member count equals distinct count).
      const allMembers = [...members.values()].flat();
      assert.equal(allMembers.length, fileIds.size, "no File node may belong to two Regions");
      assert.deepEqual(new Set(allMembers), fileIds);

      // members and primaryRegionOf agree on every assignment.
      for (const [regionId, memberIds] of members) {
        for (const id of memberIds) {
          assert.equal(primaryRegionOf.get(id), regionId);
        }
      }
    }),
    { numRuns: 100 }
  );
});

test("a file with a declared package maps to the pkg: Region (R3.1)", () => {
  const file: GraphNode = {
    id: "file:src/com/x/A.java",
    kind: "file",
    packagePath: "com.x",
    directoryPath: "src/com/x",
  };
  assert.equal(primaryRegionOfFile(file), "pkg:com.x");
});

test("a file with no declared package falls back to its directory Region (R3.1)", () => {
  const rootFile: GraphNode = { id: "file:A.java", kind: "file", directoryPath: "" };
  assert.equal(primaryRegionOfFile(rootFile), "dir:");

  const nestedFile: GraphNode = { id: "file:scratch/B.java", kind: "file", directoryPath: "scratch" };
  assert.equal(primaryRegionOfFile(nestedFile), "dir:scratch");
});

test("owningFileOf maps a file to itself and a class/function to its defining file (R3.2)", () => {
  const file: GraphNode = {
    id: "file:src/com/x/A.java",
    kind: "file",
    packagePath: "com.x",
    directoryPath: "src/com/x",
  };
  const klass: GraphNode = {
    id: "class:com.x.A",
    kind: "class",
    packagePath: "com.x",
    directoryPath: "src/com/x",
    definedInFile: file.id,
  };
  const func: GraphNode = {
    id: "func:com.x.A#m()",
    kind: "function",
    packagePath: "com.x",
    directoryPath: "src/com/x",
    definedInFile: file.id,
  };
  const nodesById = new Map<string, GraphNode>([
    [file.id, file],
    [klass.id, klass],
    [func.id, func],
  ]);

  assert.equal(owningFileOf(file, nodesById), file.id);
  assert.equal(owningFileOf(klass, nodesById), file.id);
  assert.equal(owningFileOf(func, nodesById), file.id);
});
