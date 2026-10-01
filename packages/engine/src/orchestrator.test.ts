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

test("a valid concurrency is accepted (and inert in this release)", async () => {
  const { deps } = makeDeps();
  const result = await indexProject({ projectDirectory: "/proj", concurrency: 8 }, deps);
  assert(result.ok, "expected success");
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
