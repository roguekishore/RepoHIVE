/**
 * Tests for the Orchestrator (Task 9) — the error-gate behavior of
 * {@link parseProject}.
 *
 * Covers (design: "Orchestrator (Parser_System) and error aggregation (R10)"):
 * - Fatal input failure returns exactly one {@link ParseError} and never
 *   touches collection/extraction/serialization (R1.7).
 * - A recoverable per-file error recorded during extraction gates the write:
 *   the serializer is never invoked, zero bytes are written, and any
 *   pre-existing `graph.json` is left byte-for-byte unchanged (R10.3, R10.4,
 *   R10.6).
 * - All recorded errors are returned when more than one file fails.
 * - The happy path writes exactly once with the default output path
 *   `<projectDirectory>/graph.json` and returns the serializer's success.
 *
 * Uses `node:test` with injected {@link ParseDeps} stubs so the gate is
 * verified deterministically without the real filesystem or Tree-Sitter
 * runtime. A single real-filesystem test asserts the byte-for-byte
 * prior-file-untouched guarantee end-to-end through the real serializer.
 */

import assert from "node:assert/strict";
import * as nodeFs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";

import type { DependencyEdge, GraphNode } from "@repohive/shared";

import { parseProject, type ParseDeps } from "./orchestrator.js";
import {
  ParseErrorCollector,
  err,
  makeError,
  ok,
  type ParseError,
  type ParseSuccess,
} from "./errors.js";
import type { AstExtractor } from "./ast-extractor.js";
import type { CollectedFile, ExtractionResult } from "./types.js";
import type { InputValidator, ValidatedPath } from "./input-validator.js";
import type { SourceFileCollector } from "./source-collector.js";
import type { SymbolTableBuilder, SymbolTable } from "./symbol-table.js";
import type { Stitcher } from "./stitcher.js";
import type { GraphSerializer } from "./serializer.js";

// --- Stub builders --------------------------------------------------------

const ABS_ROOT = path.resolve("/projects/demo");

function validatorOk(absolutePath = ABS_ROOT): InputValidator {
  return {
    async validate() {
      return ok<ValidatedPath, ParseError>({ absolutePath });
    },
  };
}

function validatorFail(error: ParseError): InputValidator {
  return {
    async validate() {
      return err<ValidatedPath, ParseError>([error]);
    },
  };
}

function collectorOk(files: CollectedFile[]): SourceFileCollector {
  return {
    async collect() {
      return ok<CollectedFile[], ParseError>(files);
    },
  };
}

function collectorFail(error: ParseError): SourceFileCollector {
  return {
    async collect() {
      return err<CollectedFile[], ParseError>([error]);
    },
  };
}

/**
 * An extractor whose behavior is scripted per relative path: `null` triggers a
 * recorded per-file error (simulating unparseable/unreadable), otherwise the
 * mapped {@link ExtractionResult} is returned. Tracks which files it saw.
 */
function scriptedExtractor(
  script: Record<
    string,
    { result: ExtractionResult | null; error?: ParseError }
  >,
  seen: string[],
): AstExtractor {
  return {
    extract(file: CollectedFile, errors: ParseErrorCollector) {
      seen.push(file.relativePath);
      const entry = script[file.relativePath];
      if (entry === undefined || entry.result === null) {
        errors.add(
          entry?.error ??
            makeError(
              "file-unparseable",
              `Java source file could not be parsed: ${file.relativePath}`,
              file.relativePath,
            ),
        );
        return null;
      }
      return entry.result;
    },
  };
}

const passthroughSymbolTableBuilder: SymbolTableBuilder = {
  build(): SymbolTable {
    return {
      lookup: () => null,
      lookupInScope: () => null,
      lookupAcrossScopes: () => [],
    };
  },
};

const emptyStitcher: Stitcher = {
  stitch(): DependencyEdge[] {
    return [];
  },
};

/** A serializer stub that records every write and returns success. */
function recordingSerializer(writes: {
  calls: { nodes: GraphNode[]; edges: DependencyEdge[]; outputPath: string }[];
}): GraphSerializer {
  return {
    async write(nodes, edges, outputPath) {
      writes.calls.push({ nodes, edges, outputPath });
      return ok<ParseSuccess, ParseError>({
        outputPath,
        nodeCount: nodes.length,
        edgeCount: edges.length,
      });
    },
  };
}

/** A serializer stub that fails the test if ever invoked. */
function forbiddenSerializer(): GraphSerializer {
  return {
    async write() {
      throw new Error("serializer.write must not be called when errors were recorded");
    },
  };
}

function file(relativePath: string): CollectedFile {
  return { absolutePath: path.join(ABS_ROOT, relativePath), relativePath };
}

function fileNode(relativePath: string): GraphNode {
  return { id: `file:${relativePath}`, kind: "file", directoryPath: "" };
}

function extraction(relativePath: string): ExtractionResult {
  return { nodes: [fileNode(relativePath)], references: [], packagePath: "" };
}

function baseDeps(overrides: Partial<ParseDeps>): ParseDeps {
  return {
    validator: validatorOk(),
    collector: collectorOk([file("A.java")]),
    createExtractor: async () => scriptedExtractor({}, []),
    symbolTableBuilder: passthroughSymbolTableBuilder,
    stitcher: emptyStitcher,
    serializer: forbiddenSerializer(),
    ...overrides,
  };
}

// --- Fatal input failure returns exactly one error (R1.7) -----------------

test("returns exactly one error for a fatal input failure and does no work", async () => {
  const inputError = makeError(
    "path-not-found",
    "Project directory path does not exist: /nope",
    "/nope",
  );
  let collectCalled = false;
  const deps = baseDeps({
    validator: validatorFail(inputError),
    collector: {
      async collect() {
        collectCalled = true;
        return ok<CollectedFile[], ParseError>([]);
      },
    },
  });

  const result = await parseProject({ projectDirectory: "/nope" }, deps);

  assert.ok(!result.ok);
  assert.equal(result.errors.length, 1, "exactly one error for fatal input");
  assert.equal(result.errors[0]!.reason, "path-not-found");
  assert.equal(collectCalled, false, "collection must not run after validation fails");
});

test("returns the single fatal collection error immediately", async () => {
  const collectError = makeError(
    "no-java-files",
    "No Java source files were found in the project directory: /projects/demo",
    ABS_ROOT,
  );
  const deps = baseDeps({ collector: collectorFail(collectError) });

  const result = await parseProject({ projectDirectory: ABS_ROOT }, deps);

  assert.ok(!result.ok);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.reason, "no-java-files");
});

// --- Recoverable per-file error gates the write (R10.3, R10.4) ------------

test("a recorded per-file error results in zero writes (serializer never called)", async () => {
  const seen: string[] = [];
  const deps = baseDeps({
    collector: collectorOk([file("A.java"), file("B.java")]),
    createExtractor: async () =>
      scriptedExtractor(
        {
          "A.java": { result: extraction("A.java") },
          // B.java fails to parse -> records an error, returns null.
          "B.java": { result: null },
        },
        seen,
      ),
    // Any invocation throws, proving the write is gated off.
    serializer: forbiddenSerializer(),
  });

  const result = await parseProject({ projectDirectory: ABS_ROOT }, deps);

  assert.ok(!result.ok, "run fails when a per-file error was recorded");
  assert.equal(result.errors[0]!.reason, "file-unparseable");
  assert.equal(result.errors[0]!.path, "B.java");
  // All files were still visited before the gate (parsing not aborted early).
  assert.deepEqual(seen, ["A.java", "B.java"]);
});

test("returns ALL recorded errors when multiple files fail", async () => {
  const seen: string[] = [];
  const deps = baseDeps({
    collector: collectorOk([file("A.java"), file("B.java"), file("C.java")]),
    createExtractor: async () =>
      scriptedExtractor(
        {
          "A.java": {
            result: null,
            error: makeError("file-unreadable", "unreadable A", "A.java"),
          },
          "B.java": { result: extraction("B.java") },
          "C.java": {
            result: null,
            error: makeError("file-unparseable", "unparseable C", "C.java"),
          },
        },
        seen,
      ),
    serializer: forbiddenSerializer(),
  });

  const result = await parseProject({ projectDirectory: ABS_ROOT }, deps);

  assert.ok(!result.ok);
  assert.equal(result.errors.length, 2, "both per-file errors are returned");
  assert.deepEqual(
    result.errors.map((e) => e.path).sort(),
    ["A.java", "C.java"],
  );
});

// --- Happy path: single write at the default output path ------------------

test("happy path writes exactly once at the default <projectDirectory>/graph.json", async () => {
  const writes = { calls: [] as { nodes: GraphNode[]; edges: DependencyEdge[]; outputPath: string }[] };
  const deps = baseDeps({
    collector: collectorOk([file("A.java")]),
    createExtractor: async () =>
      scriptedExtractor({ "A.java": { result: extraction("A.java") } }, []),
    serializer: recordingSerializer(writes),
  });

  const result = await parseProject({ projectDirectory: ABS_ROOT }, deps);

  assert.ok(result.ok, "happy path succeeds");
  assert.equal(writes.calls.length, 1, "serializer invoked exactly once");
  assert.equal(
    writes.calls[0]!.outputPath,
    path.join(ABS_ROOT, "graph.json"),
    "default output path is <projectDirectory>/graph.json",
  );
  assert.equal(result.value.outputPath, path.join(ABS_ROOT, "graph.json"));
});

test("honors an explicit outputPath when provided", async () => {
  const writes = { calls: [] as { nodes: GraphNode[]; edges: DependencyEdge[]; outputPath: string }[] };
  const explicit = path.join(os.tmpdir(), "custom-graph.json");
  const deps = baseDeps({
    collector: collectorOk([file("A.java")]),
    createExtractor: async () =>
      scriptedExtractor({ "A.java": { result: extraction("A.java") } }, []),
    serializer: recordingSerializer(writes),
  });

  const result = await parseProject(
    { projectDirectory: ABS_ROOT, outputPath: explicit },
    deps,
  );

  assert.ok(result.ok);
  assert.equal(writes.calls[0]!.outputPath, explicit);
});

// --- End-to-end: prior graph.json left byte-for-byte unchanged (R10.6) ----

test("leaves a pre-existing graph.json byte-for-byte unchanged when a per-file error occurs", async () => {
  const tmpRoot = await nodeFs.mkdtemp(
    path.join(os.tmpdir(), "repohive-orchestrator-"),
  );
  try {
    const outputPath = path.join(tmpRoot, "graph.json");
    // A prior valid graph.json on disk that must survive untouched.
    const priorContent = '{\n  "nodes": [],\n  "edges": []\n}\n';
    await nodeFs.writeFile(outputPath, priorContent, "utf8");

    // Use the REAL serializer so we prove the write is gated at the orchestrator
    // level (it is never invoked), not merely that a stub was skipped.
    const { createGraphSerializer } = await import("./serializer.js");
    const deps = baseDeps({
      validator: validatorOk(tmpRoot),
      collector: collectorOk([file("Broken.java")]),
      createExtractor: async () =>
        scriptedExtractor({ "Broken.java": { result: null } }, []),
      serializer: createGraphSerializer(),
    });

    const result = await parseProject({ projectDirectory: tmpRoot }, deps);

    assert.ok(!result.ok, "run fails due to the per-file error");
    const afterContent = await nodeFs.readFile(outputPath, "utf8");
    assert.equal(
      afterContent,
      priorContent,
      "prior graph.json must be byte-for-byte unchanged",
    );

    // And no temp file was left behind either.
    const entries = await nodeFs.readdir(tmpRoot);
    assert.deepEqual(
      entries.filter((e) => e.endsWith(".tmp")),
      [],
      "no temp file left behind",
    );
  } finally {
    await nodeFs.rm(tmpRoot, { recursive: true, force: true });
  }
});

// --- No exception escapes parseProject (Fix 2 — Gap 3) --------------------
//
// parseProject promised errors-as-values, but a throw from any collaborator
// escaped it. A legal Linux filename containing a backslash reached ids.ts's
// path guard, which throws, and extract wraps its call in try/finally with no
// catch — so one file crashed the whole run with a raw stack trace.

test("a throwing extractor becomes internal-error and writes nothing", async () => {
  const writes = { calls: [] as { nodes: GraphNode[]; edges: DependencyEdge[]; outputPath: string }[] };
  const result = await parseProject(
    { projectDirectory: ABS_ROOT },
    baseDeps({
      collector: collectorOk([file("A.java")]),
      createExtractor: async () => ({
        extract(): never {
          throw new Error("tree-sitter exploded");
        },
      }),
      serializer: recordingSerializer(writes),
    }),
  );

  assert.ok(!result.ok, "a throwing collaborator must not reject the promise");
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.reason, "internal-error");
  assert.match(result.errors[0]!.message, /tree-sitter exploded/);
  assert.equal(writes.calls.length, 0, "nothing may be written");
});

test("a throwing validator, collector or serializer is also converted", async () => {
  const throwing = [
    {
      label: "validator",
      deps: baseDeps({
        validator: {
          async validate(): Promise<never> {
            throw new Error("validator exploded");
          },
        },
      }),
    },
    {
      label: "collector",
      deps: baseDeps({
        collector: {
          async collect(): Promise<never> {
            throw new Error("collector exploded");
          },
        },
      }),
    },
    {
      label: "serializer",
      deps: baseDeps({
        collector: collectorOk([file("A.java")]),
        createExtractor: async () => scriptedExtractor({ "A.java": { result: extraction("A.java") } }, []),
        serializer: {
          async write(): Promise<never> {
            throw new Error("serializer exploded");
          },
        },
      }),
    },
  ];

  for (const { label, deps } of throwing) {
    const result = await parseProject({ projectDirectory: ABS_ROOT }, deps);
    assert.ok(!result.ok, `${label} must yield a Result`);
    assert.equal(result.errors[0]!.reason, "internal-error", label);
    assert.match(result.errors[0]!.message, new RegExp(`${label} exploded`), label);
  }
});

// --- Prefetch (step 3): concurrency, and its non-effect on everything else --

/**
 * An extractor that reads through the reader the orchestrator supplies,
 * recording what it got. It mirrors the real extractor's read branch (which is
 * what makes the wiring observable here); the *behavioral* claim that a
 * prefetch failure is indistinguishable from an old-style read failure is
 * proved against the real extractor in `end-to-end.test.ts`.
 */
function readingExtractor(
  readFile: (absolutePath: string) => string,
  log: { read: string[] },
): AstExtractor {
  return {
    extract(file: CollectedFile, errors: ParseErrorCollector) {
      let source: string;
      try {
        source = readFile(file.absolutePath);
      } catch {
        errors.add(
          makeError(
            "file-unreadable",
            `Java source file could not be read: ${file.relativePath}`,
            file.relativePath,
          ),
        );
        return null;
      }
      log.read.push(`${file.relativePath}=${source}`);
      return extraction(file.relativePath);
    },
  };
}

test("the prefetch reads every collected file once and extraction is served from memory", async () => {
  const files = [file("A.java"), file("B.java"), file("C.java")];
  const requested: string[] = [];
  const log = { read: [] as string[] };
  const writes = { calls: [] as { nodes: GraphNode[]; edges: DependencyEdge[]; outputPath: string }[] };

  const result = await parseProject(
    { projectDirectory: ABS_ROOT },
    baseDeps({
      collector: collectorOk(files),
      readSource: async (absolutePath) => {
        requested.push(absolutePath);
        return `source of ${path.basename(absolutePath)}`;
      },
      createExtractor: async (readFile) => readingExtractor(readFile, log),
      serializer: recordingSerializer(writes),
    }),
  );

  assert.ok(result.ok);
  // Every file read exactly once, and nothing else read.
  assert.deepEqual(
    [...requested].sort(),
    files.map((f) => f.absolutePath).sort(),
  );
  assert.equal(requested.length, files.length, "no file is read twice");
  // Extraction saw the prefetched bytes, in canonical order.
  assert.deepEqual(log.read, [
    "A.java=source of A.java",
    "B.java=source of B.java",
    "C.java=source of C.java",
  ]);
  assert.equal(writes.calls.length, 1);
});

test("zero collected files: the prefetch reads nothing and the run still completes", async () => {
  let readCalls = 0;
  const writes = { calls: [] as { nodes: GraphNode[]; edges: DependencyEdge[]; outputPath: string }[] };

  const result = await parseProject(
    { projectDirectory: ABS_ROOT },
    baseDeps({
      // The real collector reports `no-java-files` before this point; a
      // collector that legitimately yields an empty set (every file excluded by
      // a custom policy) must not hang or fault the prefetch.
      collector: collectorOk([]),
      readSource: async () => {
        readCalls += 1;
        return "";
      },
      createExtractor: async (readFile) => readingExtractor(readFile, { read: [] }),
      serializer: recordingSerializer(writes),
    }),
  );

  assert.ok(result.ok);
  assert.equal(readCalls, 0, "no reads are attempted for zero files");
  assert.equal(writes.calls.length, 1);
  assert.deepEqual(writes.calls[0]!.nodes, []);
  assert.deepEqual(writes.calls[0]!.edges, []);
});

/** Build `count` collected files named `F000.java`, `F001.java`, ... */
function manyFiles(count: number): CollectedFile[] {
  return Array.from({ length: count }, (_unused, i) =>
    file(`F${String(i).padStart(3, "0")}.java`),
  );
}

/**
 * A reader that holds every read open until released, so the number of reads
 * in flight at once is directly observable.
 */
function gatedReader(): {
  read: (absolutePath: string) => Promise<string>;
  maxInFlight: () => number;
} {
  let inFlight = 0;
  let peak = 0;
  return {
    read: async (absolutePath) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Yield twice so every worker that can start has started before any
      // read resolves.
      await Promise.resolve();
      await Promise.resolve();
      inFlight -= 1;
      return `source of ${path.basename(absolutePath)}`;
    },
    maxInFlight: () => peak,
  };
}

test("the prefetch honors an explicit concurrency, including a sequential 1", async () => {
  for (const concurrency of [1, 4]) {
    const reader = gatedReader();
    const log = { read: [] as string[] };
    const result = await parseProject(
      { projectDirectory: ABS_ROOT, concurrency },
      baseDeps({
        collector: collectorOk(manyFiles(20)),
        readSource: reader.read,
        createExtractor: async (readFile) => readingExtractor(readFile, log),
        serializer: recordingSerializer({ calls: [] }),
      }),
    );

    assert.ok(result.ok);
    assert.equal(
      reader.maxInFlight(),
      concurrency,
      `concurrency ${concurrency}: reads in flight`,
    );
    // Whatever the concurrency, extraction order is the collector's canonical
    // order. This is the determinism property, asserted directly.
    assert.deepEqual(
      log.read.map((entry) => entry.split("=")[0]),
      manyFiles(20).map((f) => f.relativePath),
    );
  }
});

test("the default prefetch concurrency is a fixed 16", async () => {
  const reader = gatedReader();
  const result = await parseProject(
    { projectDirectory: ABS_ROOT },
    baseDeps({
      collector: collectorOk(manyFiles(50)),
      readSource: reader.read,
      createExtractor: async (readFile) => readingExtractor(readFile, { read: [] }),
      serializer: recordingSerializer({ calls: [] }),
    }),
  );

  assert.ok(result.ok);
  assert.equal(reader.maxInFlight(), 16, "default concurrency");
});

test("concurrency never exceeds the file count", async () => {
  const reader = gatedReader();
  const result = await parseProject(
    { projectDirectory: ABS_ROOT, concurrency: 64 },
    baseDeps({
      collector: collectorOk(manyFiles(3)),
      readSource: reader.read,
      createExtractor: async (readFile) => readingExtractor(readFile, { read: [] }),
      serializer: recordingSerializer({ calls: [] }),
    }),
  );

  assert.ok(result.ok);
  assert.equal(reader.maxInFlight(), 3, "at most one worker per file");
});

test("a nonsense concurrency falls back to the default instead of failing the parse", async () => {
  for (const bad of [0, -5, 2.5, Number.NaN]) {
    const reader = gatedReader();
    const result = await parseProject(
      { projectDirectory: ABS_ROOT, concurrency: bad },
      baseDeps({
        collector: collectorOk(manyFiles(20)),
        readSource: reader.read,
        createExtractor: async (readFile) => readingExtractor(readFile, { read: [] }),
        serializer: recordingSerializer({ calls: [] }),
      }),
    );

    assert.ok(result.ok, `concurrency ${bad} must not fail the parse`);
    assert.equal(reader.maxInFlight(), 16, `concurrency ${bad} falls back to 16`);
  }
});

test("a prefetch read failure reaches extraction as file-unreadable, in canonical order", async () => {
  const files = [file("A.java"), file("B.java"), file("C.java")];
  const log = { read: [] as string[] };
  const writes = { calls: [] as { nodes: GraphNode[]; edges: DependencyEdge[]; outputPath: string }[] };

  const result = await parseProject(
    { projectDirectory: ABS_ROOT },
    baseDeps({
      collector: collectorOk(files),
      // C fails fast and A fails slowly, so the failures COMPLETE in the order
      // C, A while canonical order is A, C. The reported order must be the
      // canonical one.
      readSource: async (absolutePath) => {
        const name = path.basename(absolutePath);
        if (name === "C.java") {
          throw new Error("read failed fast");
        }
        if (name === "A.java") {
          await Promise.resolve();
          await Promise.resolve();
          throw new Error("read failed slowly");
        }
        return `source of ${name}`;
      },
      createExtractor: async (readFile) => readingExtractor(readFile, log),
      serializer: recordingSerializer(writes),
    }),
  );

  assert.ok(!result.ok);
  assert.deepEqual(
    result.errors.map((e) => [e.reason, e.path]),
    [
      ["file-unreadable", "A.java"],
      ["file-unreadable", "C.java"],
    ],
    "failures are reported in canonical order, not read-completion order",
  );
  // Only the file that read cleanly was extracted, and the write is gated.
  assert.deepEqual(log.read, ["B.java=source of B.java"]);
  assert.equal(writes.calls.length, 0, "recorded errors still gate the write (R10.4)");
});

test("an unrepresentable path is recorded as recoverable and blocks the write", async () => {
  const writes = { calls: [] as { nodes: GraphNode[]; edges: DependencyEdge[]; outputPath: string }[] };
  const result = await parseProject(
    { projectDirectory: ABS_ROOT },
    baseDeps({
      // The real collector reports through onUnsupportedPath; model that here.
      collector: {
        async collect(_root, options) {
          options?.onUnsupportedPath?.(
            makeError("path-unsupported", "path cannot be represented", "src/we\\ird.java"),
          );
          return ok<CollectedFile[], ParseError>([file("A.java")]);
        },
      },
      createExtractor: async () => scriptedExtractor({ "A.java": { result: extraction("A.java") } }, []),
      serializer: recordingSerializer(writes),
    }),
  );

  assert.ok(!result.ok);
  assert.equal(result.errors[0]!.reason, "path-unsupported");
  assert.equal(result.errors[0]!.path, "src/we\\ird.java");
  // Parity with file-unreadable: recorded errors gate the write (R10.4).
  assert.equal(writes.calls.length, 0);
});
