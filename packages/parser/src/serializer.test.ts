/**
 * Tests for the GraphSerializer (Task 8).
 *
 * Covers:
 * - Contract conformance & field omission (R7.2, R7.3, R7.4, R7.7): `packagePath`
 *   omitted when empty, `definedInFile` omitted on file nodes, frequencies as
 *   integers in `[0, 2147483647]`, `strength` never emitted.
 * - Final endpoint sweep (R7.6): dangling edges dropped with a diagnostic.
 * - Atomic, no-partial write (R8.4, R8.5, R10.6): serialization/temp-write/rename
 *   failures return `output-unwritable`, leave no partial file, and leave a
 *   prior valid file untouched. No temp file left on success.
 * - Zero-node / zero-edge boundary well-formedness and reproducibility (R8.2,
 *   R8.3, R9.7).
 *
 * Uses `fast-check` over `node:test`, per the design's testing strategy.
 * Happy-path tests use a real `os.tmpdir()` directory; failure branches inject
 * `SerializerDeps` stubs so no real filesystem damage is simulated.
 */

import assert from "node:assert/strict";
import * as nodeFs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
import fc from "fast-check";
import type { DependencyEdge, GraphNode } from "@repohive/shared";
import {
  createGraphSerializer,
  writeGraph,
  type SerializerDeps,
} from "./serializer.js";

// --- Real temp directory for happy-path writes ----------------------------

let tmpRoot: string;

before(async () => {
  tmpRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), "repohive-serializer-"));
});

after(async () => {
  await nodeFs.rm(tmpRoot, { recursive: true, force: true });
});

/** A deps stub that always fails the given step, tracking temp-file lifecycle. */
function failingDeps(
  failOn: "write" | "rename",
): SerializerDeps & { unlinked: string[]; renamed: boolean } {
  const state = { unlinked: [] as string[], renamed: false };
  return {
    unlinked: state.unlinked,
    get renamed() {
      return state.renamed;
    },
    async writeFile() {
      if (failOn === "write") {
        const e = new Error("simulated write failure") as NodeJS.ErrnoException;
        e.code = "EACCES";
        throw e;
      }
    },
    async rename() {
      if (failOn === "rename") {
        const e = new Error("simulated rename failure") as NodeJS.ErrnoException;
        e.code = "EPERM";
        throw e;
      }
      state.renamed = true;
    },
    async unlink(filePath: string) {
      state.unlinked.push(filePath);
    },
  };
}

// --- Example: field omission and frequency shape (R7.2, R7.3, R7.4, R7.7) --

test("omits packagePath when empty and definedInFile on file nodes", async () => {
  const nodes: GraphNode[] = [
    // file node at root: no packagePath, no definedInFile.
    { id: "file:A.java", kind: "file", packagePath: "", directoryPath: "" },
    // class node: has packagePath and definedInFile.
    {
      id: "class:com.example.A",
      kind: "class",
      packagePath: "com.example",
      directoryPath: "com/example",
      definedInFile: "file:A.java",
    },
  ];
  const outputPath = path.join(tmpRoot, "omission.json");

  const result = await writeGraph(nodes, [], outputPath);
  assert.ok(result.ok, "write should succeed");

  const text = await nodeFs.readFile(outputPath, "utf8");
  const parsed = JSON.parse(text) as { nodes: Record<string, unknown>[] };

  const fileNode = parsed.nodes.find((n) => n.id === "file:A.java")!;
  assert.ok(!("packagePath" in fileNode), "empty packagePath must be omitted");
  assert.ok(
    !("definedInFile" in fileNode),
    "definedInFile must be omitted on file nodes",
  );

  const classNode = parsed.nodes.find((n) => n.id === "class:com.example.A")!;
  assert.equal(classNode.packagePath, "com.example");
  assert.equal(classNode.definedInFile, "file:A.java");
});

test("emits frequencies as integers and never emits strength", async () => {
  const nodes: GraphNode[] = [
    { id: "file:A.java", kind: "file", directoryPath: "" },
    { id: "file:B.java", kind: "file", directoryPath: "" },
  ];
  const edges: DependencyEdge[] = [
    {
      source: "file:A.java",
      target: "file:B.java",
      importFrequency: 3,
      methodCallFrequency: 0,
      sharedTypeCount: 1,
      strength: 0.75,
    },
  ];
  const outputPath = path.join(tmpRoot, "freq.json");

  const result = await writeGraph(nodes, edges, outputPath);
  assert.ok(result.ok);

  const text = await nodeFs.readFile(outputPath, "utf8");
  const parsed = JSON.parse(text) as { edges: Record<string, unknown>[] };
  const edge = parsed.edges[0]!;
  assert.equal(edge.importFrequency, 3);
  assert.equal(edge.methodCallFrequency, 0);
  assert.equal(edge.sharedTypeCount, 1);
  assert.ok(!("strength" in edge), "strength must never be emitted");
});

// --- Example: final endpoint sweep (R7.6) ---------------------------------

test("drops dangling edges with a diagnostic and never emits them", async () => {
  const nodes: GraphNode[] = [
    { id: "file:A.java", kind: "file", directoryPath: "" },
    { id: "file:B.java", kind: "file", directoryPath: "" },
  ];
  const edges: DependencyEdge[] = [
    {
      source: "file:A.java",
      target: "file:B.java",
      importFrequency: 1,
      methodCallFrequency: 0,
      sharedTypeCount: 0,
    },
    {
      // target does not exist -> must be dropped.
      source: "file:A.java",
      target: "file:MISSING.java",
      importFrequency: 5,
      methodCallFrequency: 0,
      sharedTypeCount: 0,
    },
  ];
  const outputPath = path.join(tmpRoot, "sweep.json");

  const diagnostics: string[] = [];
  const serializer = createGraphSerializer(undefined, (m) =>
    diagnostics.push(m),
  );
  const result = await serializer.write(nodes, edges, outputPath);
  assert.ok(result.ok);
  assert.equal(result.value.edgeCount, 1, "only the valid edge is emitted");
  assert.equal(diagnostics.length, 1, "one diagnostic recorded");
  assert.match(diagnostics[0]!, /MISSING\.java/);

  const parsed = JSON.parse(await nodeFs.readFile(outputPath, "utf8")) as {
    edges: { target: string }[];
  };
  assert.equal(parsed.edges.length, 1);
  assert.equal(parsed.edges[0]!.target, "file:B.java");
});

// --- Example: no temp file left on success (R8, design testing note) ------

test("leaves no temp file behind on a successful write", async () => {
  const nodes: GraphNode[] = [
    { id: "file:A.java", kind: "file", directoryPath: "" },
  ];
  const outputPath = path.join(tmpRoot, "no-temp.json");

  const result = await writeGraph(nodes, [], outputPath);
  assert.ok(result.ok);

  const entries = await nodeFs.readdir(tmpRoot);
  const tempLeftovers = entries.filter((e) => e.endsWith("no-temp.json.tmp"));
  assert.equal(tempLeftovers.length, 0, "no .tmp file should remain");
});

// --- Example: atomic write failures (R8.4, R8.5, R10.6) -------------------

test("returns output-unwritable and no partial file when temp write fails", async () => {
  const deps = failingDeps("write");
  const outputPath = path.join(tmpRoot, "never-written.json");

  const result = await writeGraph(
    [{ id: "file:A.java", kind: "file", directoryPath: "" }],
    [],
    outputPath,
    deps,
  );

  assert.ok(!result.ok);
  assert.equal(result.errors[0]!.reason, "output-unwritable");
  assert.equal(result.errors[0]!.path, outputPath);
  assert.equal(deps.renamed, false, "rename must not run after a write failure");
  // No real file created since the stub never wrote.
  await assert.rejects(() => nodeFs.readFile(outputPath, "utf8"));
});

test("returns output-unwritable and leaves prior file untouched when rename fails", async () => {
  const outputPath = path.join(tmpRoot, "prior.json");
  // Establish a prior valid file via a real successful write.
  const first = await writeGraph(
    [{ id: "file:OLD.java", kind: "file", directoryPath: "" }],
    [],
    outputPath,
  );
  assert.ok(first.ok);
  const priorContent = await nodeFs.readFile(outputPath, "utf8");

  // Now attempt a write whose rename fails; the prior file must be intact.
  const deps = failingDeps("rename");
  const result = await writeGraph(
    [{ id: "file:NEW.java", kind: "file", directoryPath: "" }],
    [],
    outputPath,
    deps,
  );

  assert.ok(!result.ok);
  assert.equal(result.errors[0]!.reason, "output-unwritable");
  assert.deepEqual(
    deps.unlinked,
    [`${outputPath}.tmp`],
    "temp file cleaned up after rename failure",
  );

  const afterContent = await nodeFs.readFile(outputPath, "utf8");
  assert.equal(afterContent, priorContent, "prior file must be byte-identical");
});

// --- Property: zero-node/zero-edge boundary well-formedness & reproducibility

test("zero-node / zero-edge boundary emits well-formed, reproducible JSON", async () => {
  await fc.assert(
    fc.asyncProperty(
      // Either fully empty, or nodes-with-no-edges, exercising both boundaries.
      fc.uniqueArray(
        fc.string({ minLength: 1, maxLength: 8 }).map((s) => `file:${s}.java`),
        { minLength: 0, maxLength: 5 },
      ),
      async (ids) => {
        const nodes: GraphNode[] = ids.map((id) => ({
          id,
          kind: "file",
          directoryPath: "",
        }));

        const pathA = path.join(tmpRoot, "boundary-a.json");
        const pathB = path.join(tmpRoot, "boundary-b.json");

        const rA = await writeGraph(nodes, [], pathA);
        const rB = await writeGraph(nodes, [], pathB);
        assert.ok(rA.ok && rB.ok);

        // Counts equal the in-memory graph (R8.2, R8.3).
        assert.equal(rA.value.nodeCount, nodes.length);
        assert.equal(rA.value.edgeCount, 0);

        const textA = await nodeFs.readFile(pathA, "utf8");
        const textB = await nodeFs.readFile(pathB, "utf8");

        // Well-formed: parses as a single JSON value with empty edges array.
        const parsed = JSON.parse(textA) as {
          nodes: unknown[];
          edges: unknown[];
        };
        assert.equal(parsed.nodes.length, nodes.length);
        assert.deepEqual(parsed.edges, []);

        // Reproducible: identical content -> byte-identical output (R9.7).
        assert.equal(
          Buffer.compare(
            Buffer.from(textA, "utf8"),
            Buffer.from(textB, "utf8"),
          ),
          0,
        );
      },
    ),
    { numRuns: 50 },
  );
});
