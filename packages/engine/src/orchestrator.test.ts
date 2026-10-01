/**
 * Unit tests for {@link indexProject}: sequencing, stage-tagged failure
 * discrimination, path resolution, durations, progress events, and option
 * validation — all over injected fake collaborators, no real pipeline or
 * filesystem.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { join, resolve } from "node:path";

import type { RawDependencyGraph } from "@repohive/shared";
import type {
  Action,
  GroupingError,
  GroupingOutput,
  Hierarchy,
  Metadata,
  PartialGroupingConfig,
  RegionDecision,
} from "@repohive/core";
import type { ParseError, ParseOptions } from "@repohive/parser";

import { indexProject, type EngineDeps, type EngineParseSuccess } from "./orchestrator.js";

const parsedInMemoryGraph: RawDependencyGraph = {
  nodes: [{ id: "file:src/A.java", kind: "file", directoryPath: "src" }],
  edges: [],
};

const readBackGraph: RawDependencyGraph = {
  nodes: [{ id: "file:src/B.java", kind: "file", directoryPath: "src" }],
  edges: [],
};

function decision(regionId: string, action: Action): RegionDecision {
  return {
    regionId,
    cohesion: 0.4,
    coupling: 0.2,
    score: 0.6,
    action,
    automaticAction: action,
    userOverridden: false,
    decisionConfidence: 0.1,
  };
}

function fakeGroupingOutput(): GroupingOutput {
  const hierarchy: Hierarchy = {
    repositoryId: "repo:test",
    nodes: new Map(),
    leafAttributes: new Map(),
    leafEdges: [],
    crossGroupEdges: [],
    depth: 4,
  };
  const metadata: Metadata = {
    structuralQualityBoundary: 0.5,
    metricWeights: { cohesion: 0.5, coupling: 0.5 },
    cohesionSquashConstant: 10,
    regionDecisions: [
      decision("region:com.a", "preserve"),
      decision("region:com.b", "preserve"),
      decision("region:com.c", "reconstruct"),
    ],
    nodeCount: 9,
    edgeCount: 4,
    hierarchyDepth: 4,
    perLevel: [],
    totalCrossGroupEdges: 0,
    averageBranchingFactor: 2,
  };
  return { hierarchy, metadata };
}

interface RecordedCalls {
  parseOptions: ParseOptions[];
  readGraphPaths: string[];
  groupCalls: Array<{
    graph: RawDependencyGraph;
    outDir: string;
    config: PartialGroupingConfig | undefined;
  }>;
  isDirectoryPaths: string[];
  ensuredDirectories: string[];
}

/**
 * Build fully-fake collaborators that succeed by default and record every call.
 * The clock steps by 10 per read, so durations are exact and deterministic.
 */
function makeDeps(overrides: Partial<EngineDeps> = {}): { deps: EngineDeps; calls: RecordedCalls } {
  const calls: RecordedCalls = {
    parseOptions: [],
    readGraphPaths: [],
    groupCalls: [],
    isDirectoryPaths: [],
    ensuredDirectories: [],
  };
  let tick = 0;
  const deps: EngineDeps = {
    parse: async (options) => {
      calls.parseOptions.push(options);
      const value: EngineParseSuccess = {
        outputPath: options.outputPath ?? "(unset)",
        nodeCount: 12,
        edgeCount: 5,
      };
      return { ok: true, value };
    },
    readGraph: (graphPath) => {
      calls.readGraphPaths.push(graphPath);
      return { ok: true, value: readBackGraph };
    },
    group: (graph, outDir, config) => {
      calls.groupCalls.push({ graph, outDir, config });
      return { ok: true, value: fakeGroupingOutput() };
    },
    isDirectory: (candidatePath) => {
      calls.isDirectoryPaths.push(candidatePath);
      return true;
    },
    ensureDirectory: (directoryPath) => {
      calls.ensuredDirectories.push(directoryPath);
    },
    now: () => {
      const value = tick;
      tick += 10;
      return value;
    },
    ...overrides,
  };
  return { deps, calls };
}

test("success path populates every result field from what the stages reported", async () => {
  const { deps } = makeDeps();
  const result = await indexProject({ projectDirectory: "/proj" }, deps);

  assert(result.ok, "expected success");
  const value = result.value;
  const expectedRoot = resolve("/proj", ".repohive");
  assert.equal(value.outputDirectory, expectedRoot);
  assert.equal(value.graphPath, join(expectedRoot, "graph.json"));
  assert.equal(value.indexDirectory, join(expectedRoot, "index"));
  assert.equal(value.parseSkipped, false);
  assert.equal(value.nodeCount, 12);
  assert.equal(value.edgeCount, 5);
  assert.equal(value.regionCount, 3);
  assert.equal(value.preserveCount, 2);
  assert.equal(value.reconstructCount, 1);
  assert.equal(value.hierarchyDepth, 4);
  // Optional parse pass-throughs follow the parser's field-omission semantics.
  assert(!("crossScopeAmbiguities" in value));
  assert(!("excludedDirectoryCount" in value));
});

test("durations come from the injected clock and total covers both stages", async () => {
  const { deps } = makeDeps();
  const result = await indexProject({ projectDirectory: "/proj" }, deps);

  assert(result.ok, "expected success");
  const { parse, group, total } = result.value.durationMs;
  // The stepping clock advances 10 per read; each stage duration brackets
  // exactly one pair of reads.
  assert.equal(parse, 10);
  assert.equal(group, 10);
  assert(total >= parse + group, `total ${total} must cover parse ${parse} + group ${group}`);
});

test("optional parse counts pass through when the parse stage reports them", async () => {
  const { deps } = makeDeps({
    parse: async (options) => ({
      ok: true,
      value: {
        outputPath: options.outputPath ?? "(unset)",
        nodeCount: 3,
        edgeCount: 1,
        crossScopeAmbiguities: 2,
        excludedDirectoryCount: 7,
      },
    }),
  });
  const result = await indexProject({ projectDirectory: "/proj" }, deps);

  assert(result.ok, "expected success");
  assert.equal(result.value.crossScopeAmbiguities, 2);
  assert.equal(result.value.excludedDirectoryCount, 7);
});

test("without an in-memory graph the engine reads graph.json back and groups it", async () => {
  const { deps, calls } = makeDeps();
  const result = await indexProject({ projectDirectory: "/proj" }, deps);

  assert(result.ok, "expected success");
  const expectedGraphPath = join(resolve("/proj", ".repohive"), "graph.json");
  assert.deepEqual(calls.readGraphPaths, [expectedGraphPath]);
  assert.equal(calls.groupCalls.length, 1);
  assert.equal(calls.groupCalls[0]?.graph, readBackGraph);
});

test("an in-memory graph from the parse stage skips the read-back entirely", async () => {
  const { deps, calls } = makeDeps({
    parse: async (options) => ({
      ok: true,
      value: {
        outputPath: options.outputPath ?? "(unset)",
        nodeCount: 1,
        edgeCount: 0,
        graph: parsedInMemoryGraph,
      },
    }),
  });
  const result = await indexProject({ projectDirectory: "/proj" }, deps);

  assert(result.ok, "expected success");
  assert.deepEqual(calls.readGraphPaths, []);
  assert.equal(calls.groupCalls[0]?.graph, parsedInMemoryGraph);
});

test("a parse failure is stage-tagged and carries the parser errors unmodified", async () => {
  const parseErrors: ParseError[] = [
    { reason: "path-not-found", message: "Path does not exist: /proj", path: "/proj" },
    { reason: "file-unreadable", message: "Cannot read A.java", path: "A.java" },
  ];
  const { deps, calls } = makeDeps({
    parse: async () => ({ ok: false, errors: parseErrors }),
  });
  const result = await indexProject({ projectDirectory: "/proj" }, deps);

  assert(!result.ok, "expected failure");
  assert(result.stage === "parse", "expected the parse stage tag");
  assert.deepEqual([...result.errors], parseErrors);
  assert.deepEqual(calls.readGraphPaths, []);
  assert.deepEqual(calls.groupCalls, []);
});

test("a graph.json read-back failure is a group-stage failure naming the graph", async () => {
  const readError: GroupingError = { code: "FILE_NOT_FOUND", file: "whatever" };
  const { deps, calls } = makeDeps({
    readGraph: () => ({ ok: false, error: readError }),
  });
  const result = await indexProject({ projectDirectory: "/proj" }, deps);

  assert(!result.ok, "expected failure");
  assert(result.stage === "group", "expected the group stage tag");
  assert.equal(result.error, readError);
  assert.equal(result.graphPath, join(resolve("/proj", ".repohive"), "graph.json"));
  assert.deepEqual(calls.groupCalls, []);
});

test("a group failure is stage-tagged, carries the core error, and names graph.json", async () => {
  const groupError: GroupingError = {
    code: "INVALID_CONFIG",
    field: "structuralQualityBoundary",
    detail: "structuralQualityBoundary: must be a finite number (got null)",
  };
  const { deps } = makeDeps({
    group: () => ({ ok: false, error: groupError }),
  });
  const result = await indexProject({ projectDirectory: "/proj" }, deps);

  assert(!result.ok, "expected failure");
  assert(result.stage === "group", "expected the group stage tag");
  assert.equal(result.error, groupError);
  assert.equal(result.graphPath, join(resolve("/proj", ".repohive"), "graph.json"));
});

test("the output root defaults to .repohive inside the project directory", async () => {
  const { deps, calls } = makeDeps();
  await indexProject({ projectDirectory: "/proj" }, deps);

  const expectedRoot = resolve("/proj", ".repohive");
  assert.deepEqual(calls.ensuredDirectories, [expectedRoot]);
  assert.equal(calls.parseOptions[0]?.outputPath, join(expectedRoot, "graph.json"));
  assert.equal(calls.groupCalls[0]?.outDir, join(expectedRoot, "index"));
});

test("a custom output directory relocates both artifacts", async () => {
  const { deps, calls } = makeDeps();
  const result = await indexProject(
    { projectDirectory: "/proj", outputDirectory: "/elsewhere/out" },
    deps,
  );

  assert(result.ok, "expected success");
  const expectedRoot = resolve("/elsewhere/out");
  assert.deepEqual(calls.ensuredDirectories, [expectedRoot]);
  assert.equal(result.value.outputDirectory, expectedRoot);
  assert.equal(result.value.graphPath, join(expectedRoot, "graph.json"));
  assert.equal(result.value.indexDirectory, join(expectedRoot, "index"));
  assert.equal(calls.groupCalls[0]?.outDir, join(expectedRoot, "index"));
});

test("a blank output directory means unset, matching the parser's convention", async () => {
  const { deps, calls } = makeDeps();
  await indexProject({ projectDirectory: "/proj", outputDirectory: "   " }, deps);

  assert.deepEqual(calls.ensuredDirectories, [resolve("/proj", ".repohive")]);
});

test("no directory is created when the project directory is not a directory", async () => {
  const { deps, calls } = makeDeps({ isDirectory: () => false });
  const result = await indexProject({ projectDirectory: "/missing" }, deps);

  // The engine must not fabricate directories under an invalid project path;
  // the parse stage still runs and reports the canonical input error itself
  // (the fake parser succeeds here, so the run succeeds).
  assert(result.ok, "expected the run to proceed to the stages");
  assert.deepEqual(calls.ensuredDirectories, []);
  assert.equal(calls.parseOptions.length, 1);
});

test("an uncreatable output root fails before the parse stage runs", async () => {
  const { deps, calls } = makeDeps({
    ensureDirectory: () => {
      throw new Error("EACCES: permission denied");
    },
  });
  const result = await indexProject({ projectDirectory: "/proj" }, deps);

  assert(!result.ok, "expected failure");
  assert(result.stage === "engine", "expected an engine-stage failure");
  assert.equal(result.error.code, "OUTPUT_DIRECTORY_UNWRITABLE");
  assert(result.error.code === "OUTPUT_DIRECTORY_UNWRITABLE");
  assert.equal(result.error.path, resolve("/proj", ".repohive"));
  assert.match(result.error.detail, /EACCES/);
  assert.deepEqual(calls.parseOptions, []);
});

test("concurrency must be an integer >= 1 and is validated before any work", async () => {
  for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const { deps, calls } = makeDeps();
    const result = await indexProject({ projectDirectory: "/proj", concurrency: bad }, deps);

    assert(!result.ok, `expected failure for concurrency ${bad}`);
    assert(result.stage === "engine", "expected an engine-stage failure");
    assert.equal(result.error.code, "INVALID_OPTIONS");
    assert(result.error.code === "INVALID_OPTIONS");
    assert.equal(result.error.field, "concurrency");
    assert.deepEqual(calls.isDirectoryPaths, []);
    assert.deepEqual(calls.parseOptions, []);
  }
});

test("a valid concurrency is forwarded to the parse stage", async () => {
  const { deps, calls } = makeDeps();
  const result = await indexProject({ projectDirectory: "/proj", concurrency: 8 }, deps);
  assert(result.ok, "expected success");
  assert.equal(calls.parseOptions.length, 1);
  assert.equal(calls.parseOptions[0]!.concurrency, 8);
});

test("omitted concurrency is not forwarded, leaving the parser's default in force", async () => {
  const { deps, calls } = makeDeps();
  const result = await indexProject({ projectDirectory: "/proj" }, deps);
  assert(result.ok, "expected success");
  assert.equal(calls.parseOptions.length, 1);
  assert(
    !("concurrency" in calls.parseOptions[0]!),
    "concurrency must be absent, not an explicit undefined",
  );
});

test("progress events fire in stage order on success", async () => {
  const events: string[] = [];
  const { deps } = makeDeps();
  const result = await indexProject(
    {
      projectDirectory: "/proj",
      onProgress: (event) => {
        events.push(`${event.stage}:${event.kind}`);
      },
    },
    deps,
  );

  assert(result.ok, "expected success");
  assert.deepEqual(events, ["parse:start", "parse:complete", "group:start", "group:complete"]);
});

test("a failing stage emits start but not complete", async () => {
  const events: string[] = [];
  const { deps } = makeDeps({
    group: () => ({ ok: false, error: { code: "NO_GRAPH" } }),
  });
  const result = await indexProject(
    {
      projectDirectory: "/proj",
      onProgress: (event) => {
        events.push(`${event.stage}:${event.kind}`);
      },
    },
    deps,
  );

  assert(!result.ok, "expected failure");
  assert.deepEqual(events, ["parse:start", "parse:complete", "group:start"]);
});

test("a throwing progress callback is converted by the backstop, never thrown", async () => {
  const { deps } = makeDeps();
  const result = await indexProject(
    {
      projectDirectory: "/proj",
      onProgress: () => {
        throw new Error("subscriber bug");
      },
    },
    deps,
  );

  assert(!result.ok, "expected failure");
  assert(result.stage === "engine", "expected an engine-stage failure");
  assert.equal(result.error.code, "INTERNAL_ERROR");
  assert(result.error.code === "INTERNAL_ERROR");
  assert.match(result.error.detail, /subscriber bug/);
});

test("excludedSegments and grouping config pass through to their stages untouched", async () => {
  const excludedSegments = new Set(["target", "build"]);
  const grouping: PartialGroupingConfig = { structuralQualityBoundary: 0.7 };
  const { deps, calls } = makeDeps();
  const result = await indexProject(
    { projectDirectory: "/proj", excludedSegments, grouping },
    deps,
  );

  assert(result.ok, "expected success");
  assert.equal(calls.parseOptions[0]?.excludedSegments, excludedSegments);
  assert.equal(calls.groupCalls[0]?.config, grouping);
});

test("omitted excludedSegments is not forwarded as an explicit undefined", async () => {
  const { deps, calls } = makeDeps();
  await indexProject({ projectDirectory: "/proj" }, deps);

  const received = calls.parseOptions[0];
  assert(received !== undefined, "parse must have been called");
  assert(!("excludedSegments" in received));
});

// --- writeGraph ------------------------------------

test("writeGraph defaults to writing: parse gets the graph path and the result names it", async () => {
  const { deps, calls } = makeDeps();
  const result = await indexProject({ projectDirectory: "/proj" }, deps);

  assert(result.ok);
  const expectedGraph = join(resolve("/proj", ".repohive"), "graph.json");
  assert.equal(calls.parseOptions[0]?.outputPath, expectedGraph);
  assert.equal(calls.parseOptions[0]?.writeGraph, undefined, "the parser default applies");
  assert.equal(result.value.graphPath, expectedGraph);
});

test("writeGraph false tells parse not to write, and the result carries no graphPath", async () => {
  const { deps, calls } = makeDeps({
    parse: async (options) => {
      // Mirrors the real parser: no path in, no path out, graph handed over.
      assert.equal(options.outputPath, undefined);
      assert.equal(options.writeGraph, false);
      const value: EngineParseSuccess = { nodeCount: 12, edgeCount: 5, graph: parsedInMemoryGraph };
      return { ok: true, value };
    },
  });
  const result = await indexProject({ projectDirectory: "/proj", writeGraph: false }, deps);

  assert(result.ok);
  assert.equal("graphPath" in result.value, false, "the field is absent, not undefined");
  assert.deepEqual(calls.readGraphPaths, [], "nothing is read back");
  assert.equal(calls.groupCalls[0]?.graph, parsedInMemoryGraph, "group receives the in-memory graph");
});

test("writeGraph false with a parse stage that returns no graph is an engine failure, not a read of nothing", async () => {
  const { deps, calls } = makeDeps({
    parse: async () => ({ ok: true, value: { nodeCount: 1, edgeCount: 0 } }),
  });
  const result = await indexProject({ projectDirectory: "/proj", writeGraph: false }, deps);

  assert(!result.ok);
  assert.equal(result.stage, "engine");
  assert(result.stage === "engine" && result.error.code === "INTERNAL_ERROR");
  assert.deepEqual(calls.readGraphPaths, []);
  assert.deepEqual(calls.groupCalls, []);
});

test("a group failure after a skipped graph write has no graphPath", async () => {
  const { deps } = makeDeps({
    parse: async () => ({ ok: true, value: { nodeCount: 1, edgeCount: 0, graph: parsedInMemoryGraph } }),
    group: () => ({ ok: false, error: { code: "WRITE_FAILED", file: "x", detail: "boom" } }),
  });
  const result = await indexProject({ projectDirectory: "/proj", writeGraph: false }, deps);

  assert(!result.ok && result.stage === "group");
  assert.equal("graphPath" in result, false);
});

test("the success value carries the in-memory grouping output the group stage returned", async () => {
  const output = fakeGroupingOutput();
  const { deps } = makeDeps({ group: () => ({ ok: true, value: output }) });
  const result = await indexProject({ projectDirectory: "/proj" }, deps);

  assert(result.ok);
  assert.equal(result.value.groupingOutput, output, "the very object, not a copy");
});

// --- In-memory source ------------------------------

const memorySource = [{ path: "src/A.java", bytes: new TextEncoder().encode("public class A {}") }];

async function rejectsBeforeAnyWork(options: Parameters<typeof indexProject>[0], field: string, pattern: RegExp) {
  const { deps, calls } = makeDeps();
  const result = await indexProject(options, deps);
  assert(!result.ok, "expected a failure");
  assert(result.stage === "engine" && result.error.code === "INVALID_OPTIONS", JSON.stringify(result));
  assert.equal(result.error.field, field);
  assert.match(result.error.detail, pattern);
  assert.deepEqual(calls.parseOptions, [], "parse never ran");
  assert.deepEqual(calls.ensuredDirectories, [], "no directory was created");
}

test("both a directory and a source is INVALID_OPTIONS before any work", async () => {
  await rejectsBeforeAnyWork(
    { projectDirectory: "/proj", source: memorySource, outputDirectory: "/out" },
    "source",
    /not both/,
  );
});

test("neither a directory nor a source is INVALID_OPTIONS before any work", async () => {
  await rejectsBeforeAnyWork({ outputDirectory: "/out" }, "source", /neither/);
});

test("a malformed source entry is INVALID_OPTIONS before any work", async () => {
  const entry = (path: string) => ({ path, bytes: new Uint8Array() });
  for (const [bad, pattern] of [
    ["/abs/A.java", /absolute/],
    ["src/../A.java", /"\.\."/],
    ["src/./A.java", /"\."/],
    ["src//A.java", /empty/],
    ["src\\A.java", /backslash/],
  ] as const) {
    await rejectsBeforeAnyWork({ source: [entry("ok/B.java"), entry(bad)], outputDirectory: "/out" }, "source", pattern);
  }
  await rejectsBeforeAnyWork(
    { source: [entry("A.java"), entry("A.java")], outputDirectory: "/out" },
    "source",
    /duplicates/,
  );
});

test("a memory source without an outputDirectory is INVALID_OPTIONS naming that field", async () => {
  await rejectsBeforeAnyWork({ source: memorySource }, "outputDirectory", /required/);
  await rejectsBeforeAnyWork({ source: memorySource, outputDirectory: "   " }, "outputDirectory", /required/);
});

test("a memory source is passed to parse as-is, with no project directory, and the directory guard is skipped", async () => {
  const { deps, calls } = makeDeps();
  const result = await indexProject({ source: memorySource, outputDirectory: "/out" }, deps);

  assert(result.ok, JSON.stringify(result));
  assert.equal(calls.parseOptions[0]?.source, memorySource);
  assert.equal("projectDirectory" in (calls.parseOptions[0] ?? {}), false);
  assert.deepEqual(calls.isDirectoryPaths, [], "there is no project directory to check");
  assert.deepEqual(calls.ensuredDirectories, [resolve("/out")]);
  assert.equal(result.value.outputDirectory, resolve("/out"));
});

test("an invalid concurrency is still reported for a memory source, and a valid one is accepted and unused", async () => {
  await rejectsBeforeAnyWork({ source: memorySource, outputDirectory: "/out", concurrency: 0 }, "concurrency", /integer/);
  const { deps } = makeDeps();
  const result = await indexProject({ source: memorySource, outputDirectory: "/out", concurrency: 4 }, deps);
  assert(result.ok);
});
