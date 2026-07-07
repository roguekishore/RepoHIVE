/**
 * Tests for cross-file stitching and frequency-signal computation (Tasks 7.1,
 * 7.2).
 *
 * Covers the correctness properties this module underpins (design property
 * list items 4, 5, 6, 7):
 * - **Edge uniqueness (Property 5, R5.3):** at most one edge per ordered
 *   `(source, target)` pair; parallel references collapse into one edge.
 * - **No self / function edges + referential integrity (Property 4, R5.2,
 *   R5.5, R5.6):** every endpoint exists in the node set, no endpoint is a
 *   `function` node, and no edge is self-referential.
 * - **Frequency totality and non-negativity (Property 6, R6.5, R6.6):** every
 *   edge carries exactly the three contract signals, each a finite
 *   non-negative integer, with deferred signals present and exactly `0`.
 * - **Frequency recomputation determinism (Property 7, R6.7):** recomputing on
 *   identical input yields identical signal values.
 * - **Processing-order independence (Property 7, R5.7):** the edge set is
 *   independent of the order references are processed.
 *
 * Plus unit tests for reference resolution (R5.1), dropping unresolved
 * references (R5.4), and importFrequency accumulation on collapsed edges (R6.2).
 *
 * Uses `fast-check` over `node:test`, per the design's testing strategy.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import type { DependencyEdge, GraphNode } from "@repohive/shared";
import type { RawReference } from "./types.js";
import { buildSymbolTable } from "./symbol-table.js";
import { createStitcher, stitch } from "./stitcher.js";

// --- Fixed node set for unit tests ----------------------------------------

const fileA: GraphNode = {
  id: "file:src/com/example/A.java",
  kind: "file",
  packagePath: "com.example",
  directoryPath: "src/com/example",
};
const classA: GraphNode = {
  id: "class:com.example.A",
  kind: "class",
  packagePath: "com.example",
  directoryPath: "src/com/example",
  definedInFile: fileA.id,
};
const fileB: GraphNode = {
  id: "file:src/com/example/B.java",
  kind: "file",
  packagePath: "com.example",
  directoryPath: "src/com/example",
};
const classB: GraphNode = {
  id: "class:com.example.B",
  kind: "class",
  packagePath: "com.example",
  directoryPath: "src/com/example",
  definedInFile: fileB.id,
};
const funcBHelper: GraphNode = {
  id: "func:com.example.B#helper()",
  kind: "function",
  packagePath: "com.example",
  directoryPath: "src/com/example",
  definedInFile: fileB.id,
};

const baseNodes: GraphNode[] = [fileA, classA, fileB, classB, funcBHelper];

function importRef(fromNodeId: string, targetName: string): RawReference {
  return { fromNodeId, targetName, kind: "import" };
}

// --- Unit tests: resolution, scoping, dropping ----------------------------

test("resolves an import reference into one file→class edge (R5.1)", () => {
  const symbols = buildSymbolTable(baseNodes);
  const edges = stitch(baseNodes, [importRef(fileA.id, "com.example.B")], symbols);
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.source, fileA.id);
  assert.equal(edges[0]!.target, classB.id);
});

test("drops references whose target is not in the project (R5.4)", () => {
  const symbols = buildSymbolTable(baseNodes);
  const edges = stitch(
    baseNodes,
    [importRef(fileA.id, "java.util.List"), importRef(fileA.id, "com.example.*")],
    symbols,
  );
  assert.equal(edges.length, 0);
});

test("drops edges with a function endpoint (R5.2)", () => {
  const symbols = buildSymbolTable(baseNodes);
  // A static-member import resolves to a function node; it must not become an edge.
  const edges = stitch(
    baseNodes,
    [importRef(fileA.id, "com.example.B.helper")],
    symbols,
  );
  assert.equal(edges.length, 0);
});

test("drops references whose source node is absent from the node set (R5.5)", () => {
  const symbols = buildSymbolTable(baseNodes);
  const edges = stitch(
    baseNodes,
    [importRef("file:src/com/example/Ghost.java", "com.example.B")],
    symbols,
  );
  assert.equal(edges.length, 0);
});

test("drops self-referential edges (R5.6)", () => {
  const symbols = buildSymbolTable(baseNodes);
  // fileA importing its own class A resolves target to class:com.example.A,
  // whose source scope is a different node here (file vs class), so instead
  // exercise a class→same-class reference which is a true self-edge.
  const edges = stitch(
    baseNodes,
    [importRef(classA.id, "com.example.A")],
    symbols,
  );
  assert.equal(edges.length, 0);
});

test("collapses parallel references into one edge and accumulates importFrequency (R5.3, R6.2)", () => {
  const symbols = buildSymbolTable(baseNodes);
  const edges = stitch(
    baseNodes,
    [
      importRef(fileA.id, "com.example.B"),
      importRef(fileA.id, "com.example.B"),
      importRef(fileA.id, "com.example.B"),
    ],
    symbols,
  );
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.importFrequency, 3);
});

test("every edge carries exactly the three frequency signals, others 0 in Phase 1 (R6.1, R6.3, R6.4)", () => {
  const symbols = buildSymbolTable(baseNodes);
  const edges = stitch(baseNodes, [importRef(fileA.id, "com.example.B")], symbols);
  const edge = edges[0]!;
  assert.deepEqual(Object.keys(edge).sort(), [
    "importFrequency",
    "methodCallFrequency",
    "sharedTypeCount",
    "source",
    "target",
  ]);
  assert.equal(edge.methodCallFrequency, 0);
  assert.equal(edge.sharedTypeCount, 0);
  assert.ok(!("strength" in edge));
});

test("createStitcher produces an equivalent stitcher", () => {
  const symbols = buildSymbolTable(baseNodes);
  const edges = createStitcher().stitch(
    baseNodes,
    [importRef(fileA.id, "com.example.B")],
    symbols,
  );
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.target, classB.id);
});

// --- Generators for property tests ----------------------------------------

/**
 * A small project of file + class + function nodes across a fixed pool of
 * classes, so references collide and dedup / self-edge cases are exercised.
 */
const classNames = ["com.example.A", "com.example.B", "com.example.C"] as const;

const projectNodes: GraphNode[] = [];
for (const fqn of classNames) {
  const simple = fqn.slice("com.example.".length);
  const rel = `src/com/example/${simple}.java`;
  const fileId = `file:${rel}`;
  projectNodes.push({
    id: fileId,
    kind: "file",
    packagePath: "com.example",
    directoryPath: "src/com/example",
  });
  projectNodes.push({
    id: `class:${fqn}`,
    kind: "class",
    packagePath: "com.example",
    directoryPath: "src/com/example",
    definedInFile: fileId,
  });
  projectNodes.push({
    id: `func:${fqn}#helper()`,
    kind: "function",
    packagePath: "com.example",
    directoryPath: "src/com/example",
    definedInFile: fileId,
  });
}

const projectSymbols = buildSymbolTable(projectNodes);
const nodeIds = projectNodes.map((n) => n.id);

/**
 * A reference whose `fromNodeId` is any node id (including function/absent-ish
 * cases via the pool) and whose `targetName` may resolve or not — including
 * static-member names that resolve to functions and unresolvable external names.
 */
const referenceArb: fc.Arbitrary<RawReference> = fc.record({
  fromNodeId: fc.constantFrom(...nodeIds, "file:src/com/example/Ghost.java"),
  targetName: fc.constantFrom(
    ...classNames, // resolves to a class
    "com.example.A.helper", // resolves to a function
    "com.example.B.helper",
    "java.util.List", // unresolved external
    "com.example.*", // wildcard, unresolved
  ),
  kind: fc.constantFrom<RawReference["kind"]>("import", "type-use", "method-call"),
});

const referencesArb = fc.array(referenceArb, { maxLength: 30 });

/** Deterministic permutation driven by a seed array. */
function permute<T>(items: readonly T[], order: readonly number[]): T[] {
  return items
    .map((item, index) => ({ item, key: order[index] ?? index }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.item);
}

function edgeSetKey(edges: DependencyEdge[]): string {
  return edges
    .map(
      (e) =>
        `${e.source}\u0000${e.target}\u0000${e.importFrequency}\u0000${e.methodCallFrequency}\u0000${e.sharedTypeCount}`,
    )
    .sort()
    .join("\n");
}

// --- Property: edge uniqueness (R5.3) -------------------------------------

test("at most one edge exists per ordered (source, target) pair", () => {
  fc.assert(
    fc.property(referencesArb, (references) => {
      const edges = stitch(projectNodes, references, projectSymbols);
      const seen = new Set<string>();
      for (const edge of edges) {
        const key = `${edge.source}\u0000${edge.target}`;
        assert.ok(!seen.has(key), `duplicate edge for ${key}`);
        seen.add(key);
      }
    }),
  );
});

// --- Property: no self / function edges + referential integrity (R5.2, R5.5, R5.6) ---

test("no edge is self-referential, has a function endpoint, or dangles", () => {
  const nodeById = new Map(projectNodes.map((n) => [n.id, n]));
  fc.assert(
    fc.property(referencesArb, (references) => {
      const edges = stitch(projectNodes, references, projectSymbols);
      for (const edge of edges) {
        assert.notEqual(edge.source, edge.target, "self-edge emitted");
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        assert.ok(source !== undefined, `dangling source ${edge.source}`);
        assert.ok(target !== undefined, `dangling target ${edge.target}`);
        assert.notEqual(source!.kind, "function", "function source endpoint");
        assert.notEqual(target!.kind, "function", "function target endpoint");
      }
    }),
  );
});

// --- Property: frequency totality and non-negativity (Property 6, R6.5, R6.6) ---

test("every edge carries exactly three finite non-negative integer frequency signals", () => {
  fc.assert(
    fc.property(referencesArb, (references) => {
      const edges = stitch(projectNodes, references, projectSymbols);
      for (const edge of edges) {
        // Exactly the three contract frequency signals, no more, no fewer (R6.1).
        assert.deepEqual(Object.keys(edge).sort(), [
          "importFrequency",
          "methodCallFrequency",
          "sharedTypeCount",
          "source",
          "target",
        ]);
        for (const signal of [
          edge.importFrequency,
          edge.methodCallFrequency,
          edge.sharedTypeCount,
        ]) {
          // Finite, non-negative, integer — never NaN/Infinity/fraction/negative (R6.5).
          assert.ok(Number.isInteger(signal), `non-integer signal ${signal}`);
          assert.ok(signal >= 0, `negative signal ${signal}`);
        }
        // Phase-1 deferred signals are present and exactly 0, never absent (R6.3, R6.4, R6.6).
        assert.equal(edge.methodCallFrequency, 0);
        assert.equal(edge.sharedTypeCount, 0);
        // importFrequency for a present edge is at least 0 and, when the edge
        // exists, reflects a real count with no contribution left undefined (R6.6).
        assert.notEqual(edge.importFrequency, undefined);
      }
    }),
  );
});

// --- Property: frequency recomputation determinism (Property 7, R6.7) -----

test("recomputing frequency signals on identical input yields identical values", () => {
  fc.assert(
    fc.property(referencesArb, (references) => {
      const first = stitch(projectNodes, references, projectSymbols);
      const second = stitch(projectNodes, references, projectSymbols);
      // Same edges with identical importFrequency/methodCallFrequency/sharedTypeCount (R6.7).
      assert.equal(edgeSetKey(first), edgeSetKey(second));
    }),
  );
});

// --- Property: processing-order independence (R5.7) -----------------------

test("edge set is independent of reference processing order", () => {
  fc.assert(
    fc.property(
      referencesArb,
      fc.array(fc.integer(), { maxLength: 40 }),
      (references, order) => {
        const a = stitch(projectNodes, references, projectSymbols);
        const b = stitch(projectNodes, permute(references, order), projectSymbols);
        assert.equal(edgeSetKey(a), edgeSetKey(b));
      },
    ),
  );
});
