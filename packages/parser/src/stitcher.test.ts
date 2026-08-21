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
import type { CrossScopeAmbiguity, RawReference } from "./types.js";
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
        // Gap 1a (Fix 21): sharedTypeCount is now populated from type-use references, so it
        // is a finite non-negative integer but is no longer pinned to 0.  The per-signal loop
        // above already verifies the R6.5 / R6.6 invariants.  methodCallFrequency stays 0
        // until method-call extraction lands (Gap 1b).
        assert.equal(edge.methodCallFrequency, 0);
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

// --- Gap 1c: same-package simple-name resolution (Fix 22) -----------------

/** Build a type-use reference (simple name from type-use extraction). */
function typeUseRef(fromNodeId: string, targetName: string): RawReference {
  return { fromNodeId, targetName, kind: "type-use" };
}

/**
 * Minimal two-file, same-package setup for Gap 1c tests.
 * Both files and their classes live in "com.example".
 */
function samePackageNodes() {
  const fileX: GraphNode = {
    id: "file:src/com/example/X.java",
    kind: "file",
    packagePath: "com.example",
    directoryPath: "src/com/example",
  };
  const classX: GraphNode = {
    id: "class:com.example.X",
    kind: "class",
    packagePath: "com.example",
    directoryPath: "src/com/example",
    definedInFile: fileX.id,
  };
  const fileY: GraphNode = {
    id: "file:src/com/example/Y.java",
    kind: "file",
    packagePath: "com.example",
    directoryPath: "src/com/example",
  };
  const classY: GraphNode = {
    id: "class:com.example.Y",
    kind: "class",
    packagePath: "com.example",
    directoryPath: "src/com/example",
    definedInFile: fileY.id,
  };
  return { fileX, classX, fileY, classY };
}

test("same-package simple name resolves to its package sibling (Gap 1c core case)", () => {
  // X.java uses 'Y' (simple name) — no import needed within the same package.
  const { fileX, classX, fileY, classY } = samePackageNodes();
  const nodes = [fileX, classX, fileY, classY];
  const symbols = buildSymbolTable(nodes);
  // type-use reference with the bare simple name — exactly what the extractor emits.
  const refs: RawReference[] = [typeUseRef(fileX.id, "Y")];
  const edges = stitch(nodes, refs, symbols);
  assert.equal(edges.length, 1, "expected one edge for same-package type-use");
  assert.equal(edges[0]!.source, fileX.id);
  assert.equal(edges[0]!.target, classY.id);
  assert.equal(edges[0]!.sharedTypeCount, 1);
  assert.equal(edges[0]!.importFrequency, 0);
});

test("single-type import of simple name takes precedence over same-package class (JLS §7.5)", () => {
  // File X is in com.example and also has a same-package class Y.
  // It also imports com.other.Y via a single-type import.
  // The edge target must be com.other.Y, NOT com.example.Y.
  const { fileX, classX, fileY, classY } = samePackageNodes();
  // A class with the same simple name in a different package.
  const fileOtherY: GraphNode = {
    id: "file:src/com/other/Y.java",
    kind: "file",
    packagePath: "com.other",
    directoryPath: "src/com/other",
  };
  const classOtherY: GraphNode = {
    id: "class:com.other.Y",
    kind: "class",
    packagePath: "com.other",
    directoryPath: "src/com/other",
    definedInFile: fileOtherY.id,
  };
  const nodes = [fileX, classX, fileY, classY, fileOtherY, classOtherY];
  const symbols = buildSymbolTable(nodes);
  // The import reference establishes the single-type import context for fileX.
  // The type-use reference uses the bare simple name 'Y'.
  const refs: RawReference[] = [
    importRef(fileX.id, "com.other.Y"),  // single-type import
    typeUseRef(fileX.id, "Y"),           // bare name — must resolve via import, not same-pkg
  ];
  const edges = stitch(nodes, refs, symbols);
  // Should produce two edges: one from the import (to com.other.Y as a class),
  // and one from the type-use (also to com.other.Y because import wins).
  // importFrequency edge: fileX → classOtherY (from the import reference)
  // sharedTypeCount edge: fileX → classOtherY (from the type-use, resolved via import)
  // Both collapse onto one accumulated edge since same (source, target).
  const edgeToOther = edges.find((e) => e.target === classOtherY.id);
  const edgeToSamePkg = edges.find((e) => e.target === classY.id);
  assert.ok(edgeToOther !== undefined, "import-precedence must resolve to com.other.Y");
  assert.equal(edgeToOther!.sharedTypeCount, 1, "type-use must count toward sharedTypeCount");
  assert.equal(edgeToSamePkg, undefined, "same-package Y must NOT be the type-use target when import exists");
});

test("an unresolvable simple name produces no edge (R5.4)", () => {
  // 'Unknown' is neither in the same package nor imported.
  const { fileX, classX } = samePackageNodes();
  const nodes = [fileX, classX];
  const symbols = buildSymbolTable(nodes);
  const edges = stitch(nodes, [typeUseRef(fileX.id, "Unknown")], symbols);
  assert.equal(edges.length, 0, "unresolvable simple name must produce no edge");
});

test("a dotted FQN bypasses the simple-name resolution path and resolves directly", () => {
  const { fileX, classX, fileY, classY } = samePackageNodes();
  const nodes = [fileX, classX, fileY, classY];
  const symbols = buildSymbolTable(nodes);
  // FQN already works via the existing direct lookup.
  const refs: RawReference[] = [typeUseRef(fileX.id, "com.example.Y")];
  const edges = stitch(nodes, refs, symbols);
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.target, classY.id);
});

test("same-package simple name within the same file produces no self-edge (R5.6)", () => {
  // A file node referencing itself (source === target) is the self-edge case.
  // When fileX references its own classX, source=fileX.id, target=classX.id —
  // those are different ids, so it produces a valid file→class edge, NOT filtered.
  // The actual R5.6 case is when resolved target === source, e.g. a file-scoped
  // reference that resolves to the same file node id.
  // We test instead that a classX→classX reference (same id on both sides) is dropped.
  const { fileX, classX, fileY, classY } = samePackageNodes();
  const nodes = [fileX, classX, fileY, classY];
  const symbols = buildSymbolTable(nodes);
  // classX referencing 'X' — resolves to classX itself → self-edge, dropped (R5.6).
  const refs: RawReference[] = [typeUseRef(classX.id, "X")];
  const edges = stitch(nodes, refs, symbols);
  assert.equal(edges.length, 0, "class referencing its own type must produce no self-edge (R5.6)");
});

// Property: resolution is invariant under shuffling the reference array when
// same-package simple names are involved (R5.7, R6.7 — extension for Gap 1c).
test("same-package resolution is independent of reference processing order", () => {
  const { fileX, classX, fileY, classY } = samePackageNodes();
  const nodes = [fileX, classX, fileY, classY];
  const symbols = buildSymbolTable(nodes);

  const refs: RawReference[] = [
    typeUseRef(fileX.id, "Y"),
    typeUseRef(fileX.id, "Y"), // duplicate → same edge, count 2
    typeUseRef(fileY.id, "X"),
  ];

  const edgeSetKey = (edges: DependencyEdge[]) =>
    [...edges]
      .sort((a, b) => `${a.source}\0${a.target}`.localeCompare(`${b.source}\0${b.target}`))
      .map((e) => `${e.source}→${e.target}:i${e.importFrequency}:t${e.sharedTypeCount}`)
      .join("|");

  const forward = stitch(nodes, refs, symbols);
  const reversed = stitch(nodes, [...refs].reverse(), symbols);
  assert.equal(edgeSetKey(forward), edgeSetKey(reversed),
    "same-package resolution must produce identical edges regardless of reference order");
  // Verify expected counts
  const xy = forward.find((e) => e.source === fileX.id && e.target === classY.id);
  const yx = forward.find((e) => e.source === fileY.id && e.target === classX.id);
  assert.ok(xy !== undefined, "expected X→Y edge");
  assert.equal(xy!.sharedTypeCount, 2, "two type-use refs to Y must accumulate to 2");
  assert.ok(yx !== undefined, "expected Y→X edge");
  assert.equal(yx!.sharedTypeCount, 1);
});

// --- Fix 24 (Gap 2): source-root-scoped resolution ------------------------

test("resolves a reference within the referring file's own source root first (Gap 2)", () => {
  // The same FQN exists in two source roots; a reference from `core` must
  // resolve to the `core` copy, matching Java classpath semantics.
  const coreRef: GraphNode = {
    id: "file:core/com/example/Ref.java",
    kind: "file",
    packagePath: "com.example",
    directoryPath: "core/com/example",
  };
  const coreA: GraphNode = {
    id: "class:core|com.example.A",
    kind: "class",
    packagePath: "com.example",
    directoryPath: "core/com/example",
    definedInFile: "file:core/com/example/A.java",
  };
  const integA: GraphNode = {
    id: "class:integration|com.example.A",
    kind: "class",
    packagePath: "com.example",
    directoryPath: "integration/com/example",
    definedInFile: "file:integration/com/example/A.java",
  };
  const nodes = [coreRef, coreA, integA];
  const refs: RawReference[] = [
    { fromNodeId: coreRef.id, targetName: "com.example.A", kind: "import" },
  ];
  const edges = stitch(nodes, refs, buildSymbolTable(nodes));
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.target, "class:core|com.example.A");
});

test("a single cross-root match resolves as a genuine cross-module edge (Gap 2)", () => {
  const appRef: GraphNode = {
    id: "file:app/com/example/Ref.java",
    kind: "file",
    packagePath: "com.example",
    directoryPath: "app/com/example",
  };
  const libOnly: GraphNode = {
    id: "class:lib|com.example.Only",
    kind: "class",
    packagePath: "com.example",
    directoryPath: "lib/com/example",
    definedInFile: "file:lib/com/example/Only.java",
  };
  const nodes = [appRef, libOnly];
  const refs: RawReference[] = [
    { fromNodeId: appRef.id, targetName: "com.example.Only", kind: "import" },
  ];
  const ambiguities: CrossScopeAmbiguity[] = [];
  const edges = stitch(nodes, refs, buildSymbolTable(nodes), (a) => ambiguities.push(a));
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.target, "class:lib|com.example.Only");
  assert.equal(ambiguities.length, 0, "a single cross-root match is not ambiguous");
});

test("an ambiguous cross-root FQN picks byte-first and records the ambiguity (Gap 2)", () => {
  // The referrer's own root (`app`) has no `A`; two other roots do. The stitcher
  // picks the byte-first candidate deterministically and records the ambiguity.
  const appRef: GraphNode = {
    id: "file:app/com/example/Ref.java",
    kind: "file",
    packagePath: "com.example",
    directoryPath: "app/com/example",
  };
  const coreA: GraphNode = {
    id: "class:core|com.example.A",
    kind: "class",
    packagePath: "com.example",
    directoryPath: "core/com/example",
    definedInFile: "file:core/com/example/A.java",
  };
  const integA: GraphNode = {
    id: "class:integration|com.example.A",
    kind: "class",
    packagePath: "com.example",
    directoryPath: "integration/com/example",
    definedInFile: "file:integration/com/example/A.java",
  };
  const nodes = [appRef, coreA, integA];
  const refs: RawReference[] = [
    { fromNodeId: appRef.id, targetName: "com.example.A", kind: "import" },
  ];
  const ambiguities: CrossScopeAmbiguity[] = [];
  const edges = stitch(nodes, refs, buildSymbolTable(nodes), (a) => ambiguities.push(a));
  assert.equal(edges.length, 1);
  // "class:core|..." sorts before "class:integration|..." byte-wise.
  assert.equal(edges[0]!.target, "class:core|com.example.A");
  assert.equal(ambiguities.length, 1);
  assert.equal(ambiguities[0]!.targetFqn, "com.example.A");
  assert.equal(ambiguities[0]!.chosenId, "class:core|com.example.A");
  assert.deepEqual(ambiguities[0]!.candidateIds, [
    "class:core|com.example.A",
    "class:integration|com.example.A",
  ]);
  assert.equal(ambiguities[0]!.referringFile, "file:app/com/example/Ref.java");
});
