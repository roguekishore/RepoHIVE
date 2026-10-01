/**
 * Integration test: the real pipeline end-to-end over
 * `fixtures/sample-java-project`, with real parser, core, and filesystem.
 *
 * Run via `npm run test:integration --workspace @repohive/engine`. It is kept
 * out of the default unit run because the fixture is a git-ignored clone
 * target: a public clone does not have it. When the fixture is absent every
 * test here skips with an explicit message instead of failing, so the opt-in
 * run is still honest about what it did not check.
 *
 * The digest assertions compare against measurements recorded in
 * `docs/engineering/verification.md` (group digest confirmed 2026-08-22, parse
 * digest recorded 2026-08-16, both in an earlier workspace). A
 * mismatch is signal — either a determinism regression or a legitimate output
 * change — and must be investigated, never recaptured silently.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

import { INDEX_FILE_NAMES, parseIndex } from "@repohive/core";

import {
  defaultEngineDeps,
  indexProject,
  isSelectedSourcePath,
  type EngineProgressEvent,
  type SourceEntry,
} from "./index.js";

/** Root-relative fixture location; the compiled test runs from `dist/`. */
const FIXTURE = fileURLToPath(
  new URL("../../../fixtures/sample-java-project", import.meta.url),
);
const FIXTURE_PRESENT = existsSync(FIXTURE);
const SKIP_REASON =
  "fixtures/sample-java-project is absent (a git-ignored clone target); " +
  "clone it to run the integration suite";

/**
 * Recorded digests for this fixture (docs/engineering/verification.md):
 * - group: SHA-256 over the five index payloads, name + content in
 *   INDEX_FILE_NAMES order, exactly as core's demo-group-determinism computes
 *   it (4 regions, 38 nodes, depth 4). Re-baselined for the compact
 *   index format (version 1); the previous value, for the pretty-printed format,
 *   was f30c7b3d…. The format change moved these bytes and nothing else: the
 *   logical digest of the parsed index is the same before and after.
 * - parse: SHA-256 over the raw bytes of graph.json. Recorded 2026-08-16.
 */
const RECORDED_GROUP_DIGEST = "dd475c2ac4482905386c6eaeb494145d48c0b0dff552e338c310a1f29fa65b2f";
const RECORDED_PARSE_DIGEST = "a603b667abf1d7c903280a5ea661cae7087ecc90b9bafcfa9fbae25e7a6cccbc";

/** The demo-equivalent grouping digest: name + file bytes, in contract order. */
function indexDigest(indexDirectory: string): string {
  const hash = createHash("sha256");
  for (const name of INDEX_FILE_NAMES) {
    hash.update(name, "utf8");
    hash.update(readFileSync(join(indexDirectory, name)));
  }
  return hash.digest("hex");
}

function fileDigest(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

test("the real pipeline indexes the fixture and matches the recorded measurements", async (t) => {
  if (!FIXTURE_PRESENT) {
    t.skip(SKIP_REASON);
    return;
  }
  const outputDirectory = mkdtempSync(join(tmpdir(), "repohive-engine-it-"));
  try {
    const events: string[] = [];
    const result = await indexProject({
      projectDirectory: FIXTURE,
      outputDirectory,
      onProgress: (event: EngineProgressEvent) => {
        // Stage boundaries only here; the per-file and per-sub-stage events have
        // their own test below.
        if (event.kind !== "progress") {
          events.push(`${event.stage}:${event.kind}`);
        }
      },
    });

    assert(result.ok, `expected success, got: ${JSON.stringify(result)}`);
    const value = result.value;

    // Layout: graph.json plus the five-file index contract, all present and
    // well-formed JSON.
    assert.equal(value.outputDirectory, outputDirectory);
    assert.equal(value.graphPath, join(outputDirectory, "graph.json"));
    assert.equal(value.indexDirectory, join(outputDirectory, "index"));
    assert(existsSync(value.graphPath!), "graph.json must exist");
    for (const name of INDEX_FILE_NAMES) {
      const filePath = join(value.indexDirectory, name);
      assert(existsSync(filePath), `${name} must exist`);
      JSON.parse(readFileSync(filePath, "utf8"));
    }

    // The graph the result describes is the graph on disk.
    const graph = JSON.parse(readFileSync(value.graphPath!, "utf8")) as {
      nodes: unknown[];
      edges: unknown[];
    };
    assert.equal(value.nodeCount, graph.nodes.length);
    assert.equal(value.edgeCount, graph.edges.length);

    // v1 semantics and timing invariants.
    assert.equal(value.parseSkipped, false);
    assert(value.durationMs.parse > 0);
    assert(value.durationMs.group > 0);
    assert(value.durationMs.total >= value.durationMs.parse + value.durationMs.group);
    assert.deepEqual(events, ["parse:start", "parse:complete", "group:start", "group:complete"]);

    // Recorded shape of this fixture's grouping (2026-08-22): 4 regions,
    // 38 hierarchy nodes, depth 4.
    assert.equal(value.regionCount, 4, "regionCount vs recorded 2026-08-22 measurement");
    assert.equal(value.hierarchyDepth, 4, "hierarchyDepth vs recorded 2026-08-22 measurement");
    const metadata = JSON.parse(
      readFileSync(join(value.indexDirectory, "metadata.json"), "utf8"),
    ) as { nodeCount: number };
    assert.equal(metadata.nodeCount, 38, "metadata.nodeCount vs recorded 2026-08-22 measurement");

    // Timing data must never reach an artifact: nothing under the output root
    // may contain the measured durations (spot check: no file mentions
    // durationMs, and re-runs below prove byte-stability).
    for (const name of INDEX_FILE_NAMES) {
      const text = readFileSync(join(value.indexDirectory, name), "utf8");
      assert(!text.includes("durationMs"), `${name} must not carry timing data`);
    }

    // Digest comparisons against the recorded measurements. A mismatch means
    // the fixture or the engine changed since 2026-08-22: investigate and
    // record; do not recapture silently.
    assert.equal(
      indexDigest(value.indexDirectory),
      RECORDED_GROUP_DIGEST,
      "group digest vs the recorded 2026-08-22 measurement",
    );
    assert.equal(
      fileDigest(value.graphPath!),
      RECORDED_PARSE_DIGEST,
      "parse digest vs the recorded 2026-08-16 measurement",
    );
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("the in-memory handoff is live and produces byte-identical output", async (t) => {
  if (!FIXTURE_PRESENT) {
    t.skip(SKIP_REASON);
    return;
  }
  const inMemoryOut = mkdtempSync(join(tmpdir(), "repohive-engine-mem-"));
  const readBackOut = mkdtempSync(join(tmpdir(), "repohive-engine-disk-"));
  try {
    // Path A: the real default pipeline. The parser now populates
    // ParseSuccess.graph, so the engine's in-memory branch must be taken and
    // readGraph must never be reached.
    const memDeps = defaultEngineDeps();
    const memReads: string[] = [];
    const inMemory = await indexProject(
      { projectDirectory: FIXTURE, outputDirectory: inMemoryOut },
      {
        ...memDeps,
        readGraph: (graphPath) => {
          memReads.push(graphPath);
          return memDeps.readGraph(graphPath);
        },
      },
    );
    assert(inMemory.ok, `in-memory run failed: ${JSON.stringify(inMemory)}`);
    assert.deepEqual(memReads, [], "graph.json must not be read back when parse hands it over");

    // Path B: the same real pipeline with the handoff stripped from the parse
    // result, which is exactly the v1 read-back path.
    const diskDeps = defaultEngineDeps();
    const diskReads: string[] = [];
    const readBack = await indexProject(
      { projectDirectory: FIXTURE, outputDirectory: readBackOut },
      {
        ...diskDeps,
        parse: async (options) => {
          const parsed = await diskDeps.parse(options);
          if (!parsed.ok) {
            return parsed;
          }
          const value = { ...parsed.value };
          delete value.graph;
          return { ok: true, value };
        },
        readGraph: (graphPath) => {
          diskReads.push(graphPath);
          return diskDeps.readGraph(graphPath);
        },
      },
    );
    assert(readBack.ok, `read-back run failed: ${JSON.stringify(readBack)}`);
    assert.deepEqual(
      diskReads,
      [readBack.value.graphPath!],
      "stripping the handoff must restore the read-back path",
    );

    // graph.json is written either way: it is the committed layout and the
    // input to a group-only re-run.
    assert(existsSync(inMemory.value.graphPath!), "graph.json written on the in-memory path");
    assert(existsSync(readBack.value.graphPath!), "graph.json written on the read-back path");

    // And the two paths agree byte for byte, on every artifact.
    const memGraph = readFileSync(inMemory.value.graphPath!);
    const diskGraph = readFileSync(readBack.value.graphPath!);
    assert(memGraph.equals(diskGraph), "graph.json must be byte-identical across both paths");
    for (const name of INDEX_FILE_NAMES) {
      const a = readFileSync(join(inMemory.value.indexDirectory, name));
      const b = readFileSync(join(readBack.value.indexDirectory, name));
      assert(a.equals(b), `${name} must be byte-identical across both paths`);
    }
    assert.equal(indexDigest(inMemory.value.indexDirectory), RECORDED_GROUP_DIGEST);
    assert.equal(indexDigest(readBack.value.indexDirectory), RECORDED_GROUP_DIGEST);
  } finally {
    rmSync(inMemoryOut, { recursive: true, force: true });
    rmSync(readBackOut, { recursive: true, force: true });
  }
});

test("read concurrency cannot reach the artifacts", async (t) => {
  if (!FIXTURE_PRESENT) {
    t.skip(SKIP_REASON);
    return;
  }
  // The prefetch reads files concurrently, so reads complete in an order the
  // filesystem picks. Extraction still walks the collected files in canonical
  // order, so the concurrency value must be invisible in the output: default
  // (16 files at a time) and a strictly sequential 1 must agree byte for byte,
  // and both must still match the recorded digests.
  const defaultOut = mkdtempSync(join(tmpdir(), "repohive-engine-c16-"));
  const sequentialOut = mkdtempSync(join(tmpdir(), "repohive-engine-c1-"));
  try {
    const prefetched = await indexProject({
      projectDirectory: FIXTURE,
      outputDirectory: defaultOut,
    });
    const sequential = await indexProject({
      projectDirectory: FIXTURE,
      outputDirectory: sequentialOut,
      concurrency: 1,
    });
    assert(prefetched.ok, `default-concurrency run failed: ${JSON.stringify(prefetched)}`);
    assert(sequential.ok, `sequential run failed: ${JSON.stringify(sequential)}`);

    const prefetchedGraph = readFileSync(prefetched.value.graphPath!);
    const sequentialGraph = readFileSync(sequential.value.graphPath!);
    assert(
      prefetchedGraph.equals(sequentialGraph),
      "graph.json must be byte-identical across read concurrencies",
    );
    for (const name of INDEX_FILE_NAMES) {
      const a = readFileSync(join(prefetched.value.indexDirectory, name));
      const b = readFileSync(join(sequential.value.indexDirectory, name));
      assert(a.equals(b), `${name} must be byte-identical across read concurrencies`);
    }

    // Both still match the recorded measurements, so this is invariance against
    // a fixed reference rather than two runs merely agreeing with each other.
    assert.equal(fileDigest(prefetched.value.graphPath!), RECORDED_PARSE_DIGEST);
    assert.equal(fileDigest(sequential.value.graphPath!), RECORDED_PARSE_DIGEST);
    assert.equal(indexDigest(prefetched.value.indexDirectory), RECORDED_GROUP_DIGEST);
    assert.equal(indexDigest(sequential.value.indexDirectory), RECORDED_GROUP_DIGEST);
  } finally {
    rmSync(defaultOut, { recursive: true, force: true });
    rmSync(sequentialOut, { recursive: true, force: true });
  }
});

test("two runs over identical input produce byte-identical artifacts", async (t) => {
  if (!FIXTURE_PRESENT) {
    t.skip(SKIP_REASON);
    return;
  }
  const firstOut = mkdtempSync(join(tmpdir(), "repohive-engine-it1-"));
  const secondOut = mkdtempSync(join(tmpdir(), "repohive-engine-it2-"));
  try {
    const first = await indexProject({ projectDirectory: FIXTURE, outputDirectory: firstOut });
    const second = await indexProject({ projectDirectory: FIXTURE, outputDirectory: secondOut });
    assert(first.ok, `first run failed: ${JSON.stringify(first)}`);
    assert(second.ok, `second run failed: ${JSON.stringify(second)}`);

    const firstGraph = readFileSync(first.value.graphPath!);
    const secondGraph = readFileSync(second.value.graphPath!);
    assert(firstGraph.equals(secondGraph), "graph.json must be byte-identical across runs");

    for (const name of INDEX_FILE_NAMES) {
      const a = readFileSync(join(first.value.indexDirectory, name));
      const b = readFileSync(join(second.value.indexDirectory, name));
      assert(a.equals(b), `${name} must be byte-identical across runs`);
    }
  } finally {
    rmSync(firstOut, { recursive: true, force: true });
    rmSync(secondOut, { recursive: true, force: true });
  }
});

test("writeGraph false never creates graph.json and writes a byte-identical index", async (t) => {
  if (!FIXTURE_PRESENT) {
    t.skip(SKIP_REASON);
    return;
  }
  const withGraph = mkdtempSync(join(tmpdir(), "repohive-engine-wg-on-"));
  const withoutGraph = mkdtempSync(join(tmpdir(), "repohive-engine-wg-off-"));
  try {
    const sawGraphFile: string[] = [];
    const watch = (event: EngineProgressEvent): void => {
      for (const name of ["graph.json", "graph.json.tmp"]) {
        if (existsSync(join(withoutGraph, name))) {
          sawGraphFile.push(`${name} at ${event.stage}:${event.kind}`);
        }
      }
    };

    const on = await indexProject({ projectDirectory: FIXTURE, outputDirectory: withGraph });
    const off = await indexProject({
      projectDirectory: FIXTURE,
      outputDirectory: withoutGraph,
      writeGraph: false,
      onProgress: watch,
    });
    assert(on.ok, `expected success, got: ${JSON.stringify(on)}`);
    assert(off.ok, `expected success, got: ${JSON.stringify(off)}`);

    assert.deepEqual(sawGraphFile, [], "no graph file at any stage boundary");
    assert.equal(existsSync(join(withoutGraph, "graph.json")), false);
    assert.equal(existsSync(join(withoutGraph, "graph.json.tmp")), false);
    assert.equal("graphPath" in off.value, false);
    assert.equal(typeof on.value.graphPath, "string");

    // Identical index, and still the recorded digest.
    for (const name of INDEX_FILE_NAMES) {
      assert(
        readFileSync(join(on.value.indexDirectory, name)).equals(readFileSync(join(off.value.indexDirectory, name))),
        `${name} is byte-identical with and without the graph write`,
      );
    }
    assert.equal(indexDigest(off.value.indexDirectory), RECORDED_GROUP_DIGEST);

    // The in-memory grouping output describes the index that was written.
    assert.equal(off.value.groupingOutput.metadata.regionDecisions.length, off.value.regionCount);
    assert.equal(off.value.groupingOutput.hierarchy.depth, off.value.hierarchyDepth);
    const reread = parseIndex(off.value.indexDirectory);
    assert(reread.ok, `the written index parses: ${JSON.stringify(reread)}`);
    assert.deepEqual(reread.value.metadata, JSON.parse(JSON.stringify(off.value.groupingOutput.metadata)));
  } finally {
    rmSync(withGraph, { recursive: true, force: true });
    rmSync(withoutGraph, { recursive: true, force: true });
  }
});

/** Every file under `root` as memory entries: non-Java files and excluded directories included. */
function entriesOf(root: string): SourceEntry[] {
  const entries: SourceEntry[] = [];
  const walk = (dir: string): void => {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, dirent.name);
      if (dirent.isDirectory()) {
        walk(full);
      } else if (dirent.isFile()) {
        entries.push({
          path: relative(root, full).split(sep).join("/"),
          bytes: new Uint8Array(readFileSync(full)),
        });
      }
    }
  };
  walk(root);
  return entries;
}

/** How many files of the tree the engine selects, by the exported policy. */
function selectedFileCount(root: string): number {
  return entriesOf(root).filter((entry) => isSelectedSourcePath(entry.path)).length;
}

/** Every artifact under an output root, name to bytes, so two runs can be compared whole. */
function artifactsOf(outputDirectory: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (dir: string): void => {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, dirent.name);
      if (dirent.isDirectory()) {
        walk(full);
      } else {
        out.set(relative(outputDirectory, full).split(sep).join("/"), readFileSync(full));
      }
    }
  };
  walk(outputDirectory);
  return out;
}

function assertSameArtifacts(a: Map<string, Buffer>, b: Map<string, Buffer>): void {
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), "same set of files");
  for (const [name, bytes] of a) {
    assert(bytes.equals(b.get(name) as Buffer), `${name} is byte-identical`);
  }
}

test("a memory source gives byte-identical output to the directory, for sample-java-project", async (t) => {
  if (!FIXTURE_PRESENT) {
    t.skip(SKIP_REASON);
    return;
  }
  const fromDirectory = mkdtempSync(join(tmpdir(), "repohive-engine-dir-"));
  const fromMemory = mkdtempSync(join(tmpdir(), "repohive-engine-mem-"));
  try {
    const dir = await indexProject({ projectDirectory: FIXTURE, outputDirectory: fromDirectory });
    const mem = await indexProject({ source: entriesOf(FIXTURE), outputDirectory: fromMemory });
    assert(dir.ok, JSON.stringify(dir));
    assert(mem.ok, JSON.stringify(mem));

    assertSameArtifacts(artifactsOf(fromDirectory), artifactsOf(fromMemory));
    assert.equal(fileDigest(mem.value.graphPath!), RECORDED_PARSE_DIGEST);
    assert.equal(indexDigest(mem.value.indexDirectory), RECORDED_GROUP_DIGEST);
  } finally {
    rmSync(fromDirectory, { recursive: true, force: true });
    rmSync(fromMemory, { recursive: true, force: true });
  }
});

test("a tree with a byte-order mark and entries the policy drops is byte-identical either way", async () => {
  const root = mkdtempSync(join(tmpdir(), "repohive-engine-tree-"));
  const fromDirectory = mkdtempSync(join(tmpdir(), "repohive-engine-dir-"));
  const fromMemory = mkdtempSync(join(tmpdir(), "repohive-engine-mem-"));
  try {
    mkdirSync(join(root, "src", "com", "acme"), { recursive: true });
    mkdirSync(join(root, "target", "classes"), { recursive: true });
    writeFileSync(
      join(root, "src", "com", "acme", "Main.java"),
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("package com.acme;\nimport com.acme.Util;\npublic class Main { void run() { new Util().go(); } }\n"),
      ]),
    );
    writeFileSync(join(root, "src", "com", "acme", "Util.java"), "package com.acme;\npublic class Util { public void go() {} }\n");
    writeFileSync(join(root, "target", "classes", "Gen.java"), "class Gen {}\n");
    writeFileSync(join(root, "NOTES.txt"), "not java\n");

    const dir = await indexProject({ projectDirectory: root, outputDirectory: fromDirectory });
    const mem = await indexProject({ source: entriesOf(root), outputDirectory: fromMemory });
    assert(dir.ok, JSON.stringify(dir));
    assert(mem.ok, JSON.stringify(mem));
    assertSameArtifacts(artifactsOf(fromDirectory), artifactsOf(fromMemory));
    assert.equal(mem.value.nodeCount, dir.value.nodeCount);
    assert.equal(mem.value.edgeCount, dir.value.edgeCount);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(fromDirectory, { recursive: true, force: true });
    rmSync(fromMemory, { recursive: true, force: true });
  }
});

test("isSelectedSourcePath drops exactly what the engine drops", async () => {
  const everything: SourceEntry[] = [
    { path: "src/A.java", bytes: new TextEncoder().encode("public class A {}\n") },
    { path: "build/B.java", bytes: new TextEncoder().encode("public class B {}\n") },
    { path: "src/C.JAVA", bytes: new TextEncoder().encode("public class C {}\n") },
    { path: "README.md", bytes: new TextEncoder().encode("hi\n") },
  ];
  const prefiltered = everything.filter((entry) => isSelectedSourcePath(entry.path));
  assert.deepEqual(prefiltered.map((e) => e.path), ["src/A.java"]);

  const all = mkdtempSync(join(tmpdir(), "repohive-engine-all-"));
  const pre = mkdtempSync(join(tmpdir(), "repohive-engine-pre-"));
  try {
    const a = await indexProject({ source: everything, outputDirectory: all });
    const b = await indexProject({ source: prefiltered, outputDirectory: pre });
    assert(a.ok && b.ok);
    assertSameArtifacts(artifactsOf(all), artifactsOf(pre));
  } finally {
    rmSync(all, { recursive: true, force: true });
    rmSync(pre, { recursive: true, force: true });
  }
});

const WORKER_MATRIX = [1, 2, 8, 16] as const;

test("worker matrix: output is byte-identical at 1, 2, 8 and 16 workers, for a directory and for a memory source", async (t) => {
  if (!FIXTURE_PRESENT) {
    t.skip(SKIP_REASON);
    return;
  }
  const entries = entriesOf(FIXTURE);
  const outputs: Array<{ label: string; root: string }> = [];
  try {
    for (const workers of WORKER_MATRIX) {
      for (const kind of ["directory", "memory"] as const) {
        const root = mkdtempSync(join(tmpdir(), `repohive-engine-w${workers}-`));
        outputs.push({ label: `${kind} workers=${workers}`, root });
        const result = await indexProject(
          kind === "directory"
            ? { projectDirectory: FIXTURE, outputDirectory: root, workers }
            : { source: entries, outputDirectory: root, workers },
        );
        assert(result.ok, `${kind} workers=${workers}: ${JSON.stringify(result)}`);
      }
    }

    const reference = artifactsOf((outputs[0] as { root: string }).root);
    assert.equal(fileDigest(join((outputs[0] as { root: string }).root, "graph.json")), RECORDED_PARSE_DIGEST);
    assert.equal(indexDigest(join((outputs[0] as { root: string }).root, "index")), RECORDED_GROUP_DIGEST);
    for (const { label, root } of outputs.slice(1)) {
      try {
        assertSameArtifacts(reference, artifactsOf(root));
      } catch (cause) {
        throw new Error(`${label} differs from ${(outputs[0] as { label: string }).label}: ${String(cause)}`);
      }
    }
  } finally {
    for (const { root } of outputs) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a failing file with several workers fails the run and writes no artifact", async () => {
  const out = mkdtempSync(join(tmpdir(), "repohive-engine-fail-"));
  try {
    const result = await indexProject({
      source: [
        { path: "ok/A.java", bytes: new TextEncoder().encode("public class A {}\n") },
        { path: "bad/Z.java", bytes: new TextEncoder().encode("class {{{") },
        { path: "bad/B.java", bytes: new TextEncoder().encode("class }}}{") },
      ],
      outputDirectory: out,
      workers: 3,
    });
    assert(!result.ok && result.stage === "parse");
    assert.deepEqual(
      result.errors.map((e) => e.path),
      ["bad/B.java", "bad/Z.java"],
      "errors in canonical file order",
    );
    assert.deepEqual(readdirSync(out), [], "nothing was written");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("progress reports every selected file and every grouping sub-stage, and changes no byte", async (t) => {
  if (!FIXTURE_PRESENT) {
    t.skip(SKIP_REASON);
    return;
  }
  const quiet = mkdtempSync(join(tmpdir(), "repohive-engine-progress-quiet-"));
  const watched = mkdtempSync(join(tmpdir(), "repohive-engine-progress-watched-"));
  try {
    const events: EngineProgressEvent[] = [];
    const a = await indexProject({ projectDirectory: FIXTURE, outputDirectory: quiet, workers: 3 });
    const b = await indexProject({
      projectDirectory: FIXTURE,
      outputDirectory: watched,
      workers: 3,
      onProgress: (event) => events.push(event),
    });
    assert(a.ok && b.ok, `expected success, got: ${JSON.stringify(b)}`);

    const parse = events.filter((e) => e.stage === "parse" && e.kind === "progress");
    const total = selectedFileCount(FIXTURE);
    assert(parse.length >= 2, "at least the opening event and one per file");
    assert.equal(parse[0]?.completed, 0);
    assert.equal(parse[parse.length - 1]?.completed, total, "the last event reaches the total");
    let previous = 0;
    for (const event of parse) {
      assert.equal(event.total, total, "total is the number of selected files");
      assert((event.completed as number) >= previous, "completed never decreases");
      previous = event.completed as number;
    }

    const groupSubstages = events.filter((e) => e.stage === "group" && e.kind === "progress").map((e) => e.substage);
    assert.deepEqual(groupSubstages, ["ingest", "weight", "assess", "construct", "hierarchy", "metadata", "write"]);

    for (const name of INDEX_FILE_NAMES) {
      assert(
        readFileSync(join(a.value.indexDirectory, name)).equals(readFileSync(join(b.value.indexDirectory, name))),
        `${name} is byte-identical with and without a progress callback`,
      );
    }
    assert.equal(fileDigest(a.value.graphPath as string), fileDigest(b.value.graphPath as string));
  } finally {
    rmSync(quiet, { recursive: true, force: true });
    rmSync(watched, { recursive: true, force: true });
  }
});

test("work the progress callback schedules runs before the stage that emitted the event completes", async (t) => {
  if (!FIXTURE_PRESENT) {
    t.skip(SKIP_REASON);
    return;
  }
  const outputDirectory = mkdtempSync(join(tmpdir(), "repohive-engine-progress-async-"));
  try {
    let parseDone = false;
    let groupDone = false;
    let ranDuringParse = false;
    let ranDuringGroup = false;
    const result = await indexProject({
      projectDirectory: FIXTURE,
      outputDirectory,
      onProgress: (event) => {
        if (event.stage === "parse" && event.kind === "progress" && event.completed === 1) {
          setImmediate(() => {
            ranDuringParse ||= !parseDone;
          });
        }
        if (event.stage === "group" && event.substage === "ingest") {
          setImmediate(() => {
            ranDuringGroup ||= !groupDone;
          });
        }
        if (event.stage === "parse" && event.kind === "complete") {
          parseDone = true;
        }
        if (event.stage === "group" && event.kind === "complete") {
          groupDone = true;
        }
      },
    });
    assert(result.ok, `expected success, got: ${JSON.stringify(result)}`);
    assert.equal(ranDuringParse, true, "extraction lets the callback's async work run");
    assert.equal(ranDuringGroup, true, "group lets the callback's async work run");
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("a callback that throws mid-extraction or mid-group ends the run as INTERNAL_ERROR", async (t) => {
  if (!FIXTURE_PRESENT) {
    t.skip(SKIP_REASON);
    return;
  }
  for (const trigger of ["parse", "group"] as const) {
    const outputDirectory = mkdtempSync(join(tmpdir(), "repohive-engine-progress-throw-"));
    try {
      const result = await indexProject({
        projectDirectory: FIXTURE,
        outputDirectory,
        onProgress: (event) => {
          if (event.kind === "progress" && event.stage === trigger && event.completed !== 0) {
            throw new Error(`subscriber bug in ${trigger}`);
          }
          if (event.kind === "progress" && event.stage === "group" && trigger === "group" && event.substage === "construct") {
            throw new Error(`subscriber bug in ${trigger}`);
          }
        },
      });
      assert(!result.ok, `expected failure for ${trigger}`);
      assert(result.stage === "engine", `expected an engine-stage failure for ${trigger}, got ${result.stage}`);
      assert.equal(result.error.code, "INTERNAL_ERROR");
      assert.match((result.error as { detail: string }).detail, new RegExp(`subscriber bug in ${trigger}`));
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  }
});
