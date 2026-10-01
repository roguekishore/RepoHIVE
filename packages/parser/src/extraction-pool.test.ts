/**
 * The two-phase extraction pool and the encodings it
 * moves data in.
 *
 * The central claim is that the pool is a faster way to compute exactly what a
 * straight-line, single-threaded run computes, so most tests here compare the
 * pool against that straight-line oracle, built in the test from the same
 * extractor, symbol table and stitcher.
 */

import assert from "node:assert/strict";
import * as nodeFs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import type { Worker } from "node:worker_threads";

import type { DependencyEdge, GraphNode } from "@repohive/shared";

import { createAstExtractor } from "./ast-extractor.js";
import { compareEdges } from "./canonical.js";
import { ParseErrorCollector, type ParseError } from "./errors.js";
import {
  ENTRY_STRIDE,
  NODE_STRIDE,
  decodeEdges,
  decodeEntries,
  decodeNodes,
  decodeSymbolTable,
  encodeEdges,
  encodeEntry,
  encodeNode,
  encodeSymbolTable,
} from "./extraction-protocol.js";
import { createWorkerPoolPipeline, type ExtractionOutput, type FileSource } from "./extraction-pool.js";
import { parseProject } from "./orchestrator.js";
import { StringTableBuilder, decodeStrings } from "./string-table.js";
import { stitch } from "./stitcher.js";
import {
  buildSymbolTable,
  buildSymbolTableFromEntries,
  mergeSymbolEntries,
  symbolEntryOf,
  type SymbolEntry,
} from "./symbol-table.js";
import type { CollectedFile, RawReference } from "./types.js";

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

let tmpRoot: string;

before(async () => {
  tmpRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), "repohive-pool-"));
});

after(async () => {
  await nodeFs.rm(tmpRoot, { recursive: true, force: true });
});

// --- String tables --------------------------------------------------------------

test("a string table round-trips every string exactly, including empty, repeated and non-BMP text", () => {
  const values = ["", "plain", "Ünï/cödé.java", "日本語/パス", "emoji 😀 \u{1F680}", "a\nb\tc", "plain", "", "x".repeat(10_000)];
  const table = new StringTableBuilder();
  const ids = values.map((value) => table.intern(value));
  assert.equal(table.size, 7, "repeats share one id");
  assert.equal(ids[0], ids[7]);
  assert.equal(ids[1], ids[6]);

  for (const shared of [false, true]) {
    const decoded = decodeStrings(table.encode(shared));
    assert.deepEqual(ids.map((id) => decoded[id]), values, `shared=${shared}`);
  }
});

test("a string table can be placed in shared memory, and an empty one decodes to nothing", () => {
  const table = new StringTableBuilder();
  table.intern("a");
  const encoded = table.encode(true);
  assert.ok(encoded.bytes.buffer instanceof SharedArrayBuffer);
  assert.ok(encoded.offsets.buffer instanceof SharedArrayBuffer);
  assert.deepEqual(decodeStrings(new StringTableBuilder().encode()), []);
});

// --- Record codecs ---------------------------------------------------------------

test("nodes round-trip, keeping absent, empty and present optional fields distinct", () => {
  const nodes: GraphNode[] = [
    { id: "file:A.java", kind: "file", directoryPath: "" },
    { id: "file:p/B.java", kind: "file", packagePath: "", directoryPath: "p" },
    { id: "class:src|p.B", kind: "class", packagePath: "p", directoryPath: "p", definedInFile: "file:p/B.java" },
    { id: "func:src|p.B#m(int)", kind: "function", packagePath: "p", directoryPath: "p", definedInFile: "file:p/B.java" },
  ];
  const strings = new StringTableBuilder();
  const records: number[] = [];
  for (const node of nodes) {
    encodeNode(node, strings, records);
  }
  assert.equal(records.length, nodes.length * NODE_STRIDE);
  const decoded = decodeNodes(Int32Array.from(records), 0, nodes.length, decodeStrings(strings.encode()));
  assert.deepEqual(decoded, nodes);
  assert.equal("packagePath" in (decoded[0] as GraphNode), false, "absent stays absent");
  assert.equal((decoded[1] as GraphNode).packagePath, "", "empty stays empty");
});

test("a node of a kind the parser never produces is refused, not mis-encoded", () => {
  assert.throws(
    () => encodeNode({ id: "group:x", kind: "group", directoryPath: "" } as GraphNode, new StringTableBuilder(), []),
    /kind "group"/,
  );
});

test("symbol entries and edges round-trip, edges at the contract's integer maximum", () => {
  const entries: SymbolEntry[] = [
    { id: "class:src|p.B", key: "p.B", scope: "src", kind: "class" },
    { id: "func:p.B#m()", key: "p.B.m", scope: "", kind: "function" },
  ];
  const strings = new StringTableBuilder();
  const flat: number[] = [];
  for (const entry of entries) {
    encodeEntry(entry, strings, flat);
  }
  assert.equal(flat.length, entries.length * ENTRY_STRIDE);
  assert.deepEqual(decodeEntries(Int32Array.from(flat), 0, 2, decodeStrings(strings.encode())), entries);

  const edges: DependencyEdge[] = [
    { source: "file:a", target: "file:b", importFrequency: 2147483647, methodCallFrequency: 0, sharedTypeCount: 3 },
    { source: "file:b", target: "class:c", importFrequency: 0, methodCallFrequency: 1, sharedTypeCount: 0 },
  ];
  const encoded = encodeEdges(edges);
  assert.deepEqual(decodeEdges(encoded.strings, encoded.records), edges);
});

test("the shared symbol-table payload decodes to the entries it was built from", () => {
  const entries: SymbolEntry[] = [
    { id: "class:a.A", key: "a.A", scope: "", kind: "class" },
    { id: "class:a.A$B", key: "a.A.B", scope: "", kind: "class" },
    { id: "func:a.A#go()", key: "a.A.go", scope: "", kind: "function" },
  ];
  const payload = encodeSymbolTable(entries);
  assert.ok(payload.entries.buffer instanceof SharedArrayBuffer);
  assert.deepEqual(decodeSymbolTable(payload), entries);
});

// --- Symbol table: entries versus nodes -------------------------------------------

test("a table built from merged per-file entries answers exactly like one built from the node set", () => {
  const nodes: GraphNode[] = [
    { id: "file:src/p/B.java", kind: "file", packagePath: "p", directoryPath: "src/p" },
    { id: "class:src|p.B", kind: "class", packagePath: "p", directoryPath: "src/p", definedInFile: "file:src/p/B.java" },
    { id: "func:src|p.B#m(int)", kind: "function", packagePath: "p", directoryPath: "src/p", definedInFile: "file:src/p/B.java" },
    { id: "file:lib/p/B.java", kind: "file", packagePath: "p", directoryPath: "lib/p" },
    { id: "class:lib|p.B", kind: "class", packagePath: "p", directoryPath: "lib/p", definedInFile: "file:lib/p/B.java" },
    { id: "file:src/p/C.java", kind: "file", packagePath: "p", directoryPath: "src/p" },
    { id: "class:src|p.C$Inner", kind: "class", packagePath: "p", directoryPath: "src/p", definedInFile: "file:src/p/C.java" },
  ];
  const direct = buildSymbolTable(nodes);

  // Entries per "file", in a deliberately scrambled file order, merged.
  const perFile: SymbolEntry[][] = [];
  for (const group of [nodes.slice(5), nodes.slice(0, 3), nodes.slice(3, 5)]) {
    perFile.push(group.map(symbolEntryOf).filter((entry): entry is SymbolEntry => entry !== null));
  }
  const merged = buildSymbolTableFromEntries(mergeSymbolEntries(perFile));

  for (const fqn of ["p.B", "p.B.m", "p.C.Inner", "p.Missing"]) {
    assert.deepEqual(merged.lookupAcrossScopes(fqn), direct.lookupAcrossScopes(fqn), fqn);
    assert.equal(merged.lookup(fqn), direct.lookup(fqn), fqn);
    for (const scope of ["src", "lib", "other"]) {
      assert.equal(merged.lookupInScope(scope, fqn), direct.lookupInScope(scope, fqn), `${scope}:${fqn}`);
    }
  }
  assert.equal(merged.kindOf("class:src|p.B"), "class");
  assert.equal(merged.kindOf("func:src|p.B#m(int)"), "function");
  assert.equal(merged.kindOf("file:src/p/B.java"), undefined, "file nodes are not keyed");
  assert.equal(merged.kindOf("class:nope"), undefined);
});

// --- The pool against a straight-line oracle ----------------------------------------

/** A project with imports, wildcard imports, a static import, nesting, two source roots, and a cross-root duplicate. */
function sampleProject(): Array<{ path: string; text: string }> {
  const files: Array<{ path: string; text: string }> = [
    {
      path: "src/main/java/com/acme/app/Main.java",
      text: [
        "package com.acme.app;",
        "import com.acme.model.User;",
        "import com.acme.util.*;",
        "import static com.acme.util.Strings.shout;",
        "public class Main {",
        "  User user = new User();",
        "  Strings helper;",
        "  void run() { shout(\"x\"); }",
        "}",
      ].join("\n"),
    },
    {
      path: "src/main/java/com/acme/model/User.java",
      text: "package com.acme.model;\npublic class User { public static class Role {} Role role; }\n",
    },
    {
      path: "src/main/java/com/acme/util/Strings.java",
      text: "package com.acme.util;\npublic class Strings { public static String shout(String s) { return s; } }\n",
    },
    {
      path: "src/test/java/com/acme/model/UserTest.java",
      text: "package com.acme.model;\nimport com.acme.model.User;\npublic class UserTest { User u; }\n",
    },
    // The same FQN in two source roots, referenced from a third: an ambiguity.
    { path: "mod-a/src/com/dup/Dup.java", text: "package com.dup;\npublic class Dup {}\n" },
    { path: "mod-b/src/com/dup/Dup.java", text: "package com.dup;\npublic class Dup {}\n" },
    { path: "mod-c/src/com/use/Use.java", text: "package com.use;\nimport com.dup.Dup;\npublic class Use { Dup d; }\n" },
    { path: "Root.java", text: "public class Root {}\n" },
  ];
  // Enough extra files that several workers each get some.
  for (let i = 0; i < 24; i += 1) {
    const target = ["User", "Strings", "Main"][i % 3];
    const pkg = ["com.acme.model", "com.acme.util", "com.acme.app"][i % 3];
    files.push({
      path: `src/main/java/com/acme/gen/G${String(i).padStart(2, "0")}.java`,
      text: `package com.acme.gen;\nimport ${pkg}.${target};\npublic class G${i} { ${target} ref; void m(${target} p) {} }\n`,
    });
  }
  return files;
}

function collected(files: Array<{ path: string }>): CollectedFile[] {
  return files.map((f) => ({ absolutePath: f.path, relativePath: f.path })).sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1));
}

function memorySource(files: Array<{ path: string; text: string }>): FileSource {
  const bytes = new Map(files.map((f) => [f.path, enc(f.text)]));
  return {
    size: async (file) => (bytes.get(file.absolutePath) as Uint8Array).byteLength,
    read: async (file) => (bytes.get(file.absolutePath) as Uint8Array).slice(),
  };
}

/** The single-threaded computation the pool must equal. */
async function straightLine(files: Array<{ path: string; text: string }>): Promise<{
  nodes: GraphNode[];
  edges: DependencyEdge[];
  ambiguities: number;
  errors: ParseError[];
}> {
  const texts = new Map(files.map((f) => [f.path, f.text]));
  const extractor = await createAstExtractor({ readFile: (p) => texts.get(p) as string });
  const errors = new ParseErrorCollector();
  const nodes: GraphNode[] = [];
  const references: RawReference[] = [];
  for (const file of collected(files)) {
    const extraction = extractor.extract(file, errors);
    if (extraction !== null) {
      nodes.push(...extraction.nodes);
      references.push(...extraction.references);
    }
  }
  let ambiguities = 0;
  const edges = stitch(nodes, references, buildSymbolTable(nodes), () => {
    ambiguities += 1;
  });
  return { nodes, edges: edges.sort(compareEdges), ambiguities, errors: errors.errors() };
}

function normalized(output: ExtractionOutput): { nodes: GraphNode[]; edges: DependencyEdge[]; ambiguities: number } {
  return { nodes: output.nodes, edges: [...output.edges].sort(compareEdges), ambiguities: output.crossScopeAmbiguities };
}

test("the pool computes exactly what a single-threaded run computes, at every worker count", async () => {
  const files = sampleProject();
  const oracle = await straightLine(files);
  assert.deepEqual(oracle.errors, []);
  assert.ok(oracle.edges.length > 20, "the project has real edges");
  assert.ok(oracle.ambiguities >= 1, "the project has a cross-root ambiguity");

  for (const workers of [1, 2, 3, 8]) {
    const result = await createWorkerPoolPipeline().run({
      files: collected(files),
      source: memorySource(files),
      workers,
      readConcurrency: 4,
    });
    assert.ok(result.ok, `workers=${workers}: ${JSON.stringify(result)}`);
    assert.deepEqual(
      normalized(result.value),
      { nodes: oracle.nodes, edges: oracle.edges, ambiguities: oracle.ambiguities },
      `workers=${workers}`,
    );
  }
});

test("nodes come back in canonical file order, not worker or completion order", async () => {
  const files = sampleProject();
  const result = await createWorkerPoolPipeline().run({
    files: collected(files),
    // Reverse the size order so the biggest-first schedule is far from canonical order.
    source: memorySource(files),
    workers: 4,
    readConcurrency: 8,
  });
  assert.ok(result.ok);
  const fileIds = result.value.nodes.filter((n) => n.kind === "file").map((n) => n.id);
  assert.deepEqual(fileIds, collected(files).map((f) => `file:${f.relativePath}`));
});

test("a worker count above the file count is harmless", async () => {
  const files = sampleProject().slice(0, 2);
  const oracle = await straightLine(files);
  const result = await createWorkerPoolPipeline().run({
    files: collected(files),
    source: memorySource(files),
    workers: 64,
    readConcurrency: 4,
  });
  assert.ok(result.ok);
  assert.deepEqual(normalized(result.value).nodes, oracle.nodes);
});

test("per-file errors come back in canonical file order whichever worker finds them first", async () => {
  const files = [
    ...sampleProject(),
    { path: "bad/Z.java", text: "class {{{" },
    { path: "bad/A.java", text: "class }}}{" },
    { path: "bad/M.java", text: "public class {" },
  ];
  const result = await createWorkerPoolPipeline().run({
    files: collected(files),
    source: memorySource(files),
    workers: 4,
    readConcurrency: 4,
  });
  assert.ok(!result.ok);
  assert.deepEqual(
    result.errors.map((e) => [e.reason, e.path]),
    [
      ["file-unparseable", "bad/A.java"],
      ["file-unparseable", "bad/M.java"],
      ["file-unparseable", "bad/Z.java"],
    ],
  );
});

test("an unreadable file is file-unreadable and the other files' errors are still reported", async () => {
  const files = [...sampleProject(), { path: "bad/Broken.java", text: "class {{{" }];
  const inner = memorySource(files);
  const result = await createWorkerPoolPipeline().run({
    files: collected(files),
    source: {
      size: inner.size,
      read: async (file) => {
        if (file.relativePath === "Root.java") {
          throw new Error("disk on fire");
        }
        return inner.read(file);
      },
    },
    workers: 3,
    readConcurrency: 4,
  });
  assert.ok(!result.ok);
  assert.deepEqual(
    result.errors.map((e) => [e.reason, e.path]),
    // Byte-wise order: "Root.java" (0x52) sorts before "bad/Broken.java" (0x62).
    [
      ["file-unreadable", "Root.java"],
      ["file-unparseable", "bad/Broken.java"],
    ],
  );
});

test("a size that cannot be read does not fail the run", async () => {
  const files = sampleProject().slice(0, 5);
  const inner = memorySource(files);
  const result = await createWorkerPoolPipeline().run({
    files: collected(files),
    source: {
      size: async () => {
        throw new Error("stat failed");
      },
      read: inner.read,
    },
    workers: 2,
    readConcurrency: 2,
  });
  assert.ok(result.ok);
});

test("the caller's source bytes are not detached or altered by a run", async () => {
  const entries = sampleProject().map((f) => ({ path: f.path, bytes: enc(f.text) }));
  const lengths = entries.map((e) => e.bytes.byteLength);
  const result = await parseProject({ source: entries, writeGraph: false, workers: 3 });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(entries.map((e) => e.bytes.byteLength), lengths, "no buffer was transferred away");
  assert.equal(new TextDecoder().decode(entries[0]?.bytes), sampleProject()[0]?.text);
});

// --- Failure: crashes, exits, reported failures, and no worker left running ----------

async function workerScript(name: string, body: string): Promise<URL> {
  const file = path.join(tmpRoot, name);
  await nodeFs.writeFile(file, body, "utf8");
  return pathToFileURL(file);
}

/** Collect the workers a pool creates and when each one exits. */
function watchWorkers(): { onWorker: (worker: Worker) => void; created: number[]; exited: Set<number> } {
  // A worker's threadId reads -1 once it has exited, so capture it at creation.
  const created: number[] = [];
  const exited = new Set<number>();
  return {
    created,
    exited,
    onWorker: (worker) => {
      const id = worker.threadId;
      created.push(id);
      worker.on("exit", () => exited.add(id));
    },
  };
}

test("a worker that crashes fails the run with worker-failed and every worker is terminated", async () => {
  // Odd-numbered threads crash after saying they are ready; even-numbered ones stay alive forever.
  const workerUrl = await workerScript(
    "crash-some.mjs",
    `import { parentPort, threadId } from "node:worker_threads";
     parentPort.on("message", () => { if (threadId % 2 === 1) { throw new Error("boom"); } });
     parentPort.postMessage({ type: "ready" });
     setInterval(() => {}, 1000);`,
  );
  const watch = watchWorkers();
  const files = sampleProject();
  const result = await createWorkerPoolPipeline({ workerUrl, onWorker: watch.onWorker }).run({
    files: collected(files),
    source: memorySource(files),
    workers: 4,
    readConcurrency: 4,
  });

  assert.ok(!result.ok);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]?.reason, "worker-failed");
  assert.match(result.errors[0]?.message ?? "", /crashed.*boom/);
  assert.equal(watch.created.length, 4);
  assert.deepEqual(
    [...watch.exited].sort(),
    [...watch.created].sort(),
    "every worker, crashed or not, has exited by the time the run returns",
  );
});

test("a worker that exits without a word fails the run with worker-failed", async () => {
  const workerUrl = await workerScript(
    "exit-quietly.mjs",
    `import { parentPort } from "node:worker_threads";
     parentPort.postMessage({ type: "ready" });
     parentPort.on("message", () => process.exit(7));`,
  );
  const watch = watchWorkers();
  const files = sampleProject();
  const result = await createWorkerPoolPipeline({ workerUrl, onWorker: watch.onWorker }).run({
    files: collected(files),
    source: memorySource(files),
    workers: 2,
    readConcurrency: 2,
  });

  assert.ok(!result.ok);
  assert.equal(result.errors[0]?.reason, "worker-failed");
  assert.match(result.errors[0]?.message ?? "", /exited unexpectedly \(code 7\)/);
  assert.equal(watch.exited.size, watch.created.length);
});

test("a worker that reports its own failure surfaces as a thrown error, which parseProject turns into internal-error", async () => {
  const workerUrl = await workerScript(
    "report-failure.mjs",
    `import { parentPort } from "node:worker_threads";
     parentPort.postMessage({ type: "ready" });
     parentPort.on("message", () => parentPort.postMessage({ type: "failed", message: "tree-sitter exploded" }));`,
  );
  const files = sampleProject();
  await assert.rejects(
    () =>
      createWorkerPoolPipeline({ workerUrl }).run({
        files: collected(files),
        source: memorySource(files),
        workers: 2,
        readConcurrency: 2,
      }),
    /tree-sitter exploded/,
  );

  const result = await parseProject(
    { source: files.map((f) => ({ path: f.path, bytes: enc(f.text) })), writeGraph: false },
    {
      validator: { validate: async () => assert.fail("not used for a memory source") },
      collector: { collect: async () => assert.fail("not used for a memory source") },
      pipeline: createWorkerPoolPipeline({ workerUrl }),
      serializer: { write: async () => assert.fail("nothing may be written after a failure") },
    },
  );
  assert.ok(!result.ok);
  assert.equal(result.errors[0]?.reason, "internal-error");
  assert.match(result.errors[0]?.message ?? "", /tree-sitter exploded/);
});

test("a run that fails writes no file", async () => {
  const workerUrl = await workerScript(
    "crash-all.mjs",
    `import { parentPort } from "node:worker_threads";
     parentPort.postMessage({ type: "ready" });
     parentPort.on("message", () => { throw new Error("boom"); });`,
  );
  const out = path.join(tmpRoot, "must-not-exist.json");
  const files = sampleProject();
  const result = await parseProject(
    { source: files.map((f) => ({ path: f.path, bytes: enc(f.text) })), outputPath: out },
    {
      validator: { validate: async () => assert.fail("not used") },
      collector: { collect: async () => assert.fail("not used") },
      pipeline: createWorkerPoolPipeline({ workerUrl }),
      serializer: { write: async () => assert.fail("nothing may be written after a failure") },
    },
  );
  assert.ok(!result.ok);
  assert.equal(result.errors[0]?.reason, "worker-failed");
  await assert.rejects(() => nodeFs.stat(out));
});

test("after a successful run no worker is left running", async () => {
  const watch = watchWorkers();
  const files = sampleProject();
  const result = await createWorkerPoolPipeline({ onWorker: watch.onWorker }).run({
    files: collected(files),
    source: memorySource(files),
    workers: 3,
    readConcurrency: 4,
  });
  assert.ok(result.ok);
  assert.equal(watch.created.length, 3);
  assert.equal(watch.exited.size, 3, "every worker has exited");
});

test("only workers that were handed a file take part: a pool wider than the work still finishes", async () => {
  const files = sampleProject().slice(0, 2);
  const watch = watchWorkers();
  const result = await createWorkerPoolPipeline({ onWorker: watch.onWorker }).run({
    files: collected(files),
    source: memorySource(files),
    workers: 12,
    readConcurrency: 4,
  });
  assert.ok(result.ok);
  assert.equal(watch.created.length, 2, "never more threads than files");
});

test("node and entry strides match the record layout the codecs write", () => {
  assert.equal(NODE_STRIDE, 5);
  assert.equal(ENTRY_STRIDE, 4);
});
