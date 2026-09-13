/**
 * Pipeline orchestrator: run parse then group in one call.
 *
 * {@link indexProject} sequences the two batch stages that were previously
 * joined only by root npm scripts:
 *
 * 1. **Validate engine options** (`concurrency`). An invalid option costs an
 *    error message, not a completed parse.
 * 2. **Prepare the output root** (default `<projectDirectory>/.repohive`),
 *    guarded on the project directory actually being a directory — the guard
 *    exists so a bad `projectDirectory` still gets the parser's canonical input
 *    error, rather than the engine first fabricating directories under a path
 *    the parser is about to reject (which would flip a `path-not-found` into a
 *    `no-java-files`).
 * 3. **Parse** via `@repohive/parser`'s `parseProject`, writing
 *    `<outputRoot>/graph.json`. A failure returns the parser's errors,
 *    stage-tagged; the parser guarantees no partial output.
 * 4. **Acquire the graph for grouping**: use the in-memory graph when the parse
 *    stage handed one over ({@link EngineParseSuccess.graph}), otherwise read
 *    `graph.json` back from disk. `parseProject` populates the field, so the
 *    default pipeline takes the in-memory branch and never reads the file back;
 *    the read-back remains for a `parse` dependency that returns no graph.
 *    `graph.json` is always written either way: it is part of the committed
 *    `.repohive/` layout and what makes group-only sweeps possible.
 * 5. **Group** via `@repohive/core`'s `groupGraphToIndex`, writing the
 *    five-file index contract to `<outputRoot>/index`. Core validates the
 *    grouping config, groups, and serializes all-or-nothing.
 * 6. Return an {@link EngineSuccess} carrying paths, counts, `parseSkipped`
 *    (always `false` in v1 — the engine always parses; skip-when-current is the
 *    snapshot-id seam), and monotonic-clock durations. Timing data lives only
 *    on this in-memory result and never reaches an artifact.
 *
 * All collaborators are injected via {@link EngineDeps} with real defaults
 * ({@link defaultEngineDeps}), the same house pattern as `parseProject`'s
 * `ParseDeps` and the core serializer's `IndexSerializerDeps`.
 */

import { mkdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

import type { RawDependencyGraph } from "@repohive/shared";
import {
  parseProject,
  type ParseError,
  type ParseOptions,
  type ParseSuccess,
  type Result as ParseResult,
} from "@repohive/parser";
import {
  groupGraphToIndex,
  readGraphFile,
  type GroupingOutput,
  type PartialGroupingConfig,
  type Result as CoreResult,
} from "@repohive/core";

import type { EngineResult, EngineStage, EngineSuccess } from "./errors.js";

/** Name of the default output directory created inside the project directory. */
const DEFAULT_OUTPUT_DIRECTORY_NAME = ".repohive";
/** Name of the stage-1 artifact inside the output root. */
const GRAPH_FILE_NAME = "graph.json";
/** Name of the stage-2 directory (the five-file contract) inside the output root. */
const INDEX_DIRECTORY_NAME = "index";

/**
 * Kinds of progress event. v1 fires `"start"` and `"complete"` at stage
 * boundaries only. `"progress"` is **reserved**: it is declared now so the type
 * never has to change, but it is never emitted in v1. When per-item granularity
 * lands (progress is a first-class engine output for the hosted path's SSE),
 * the engine starts emitting `"progress"` events with `completed`/`total`
 * populated — a pure behavior addition, no signature change.
 */
export type EngineProgressKind = "start" | "complete" | "progress";

/** A coarse progress event. See {@link EngineProgressKind} for the v1 semantics. */
export interface EngineProgressEvent {
  /** The pipeline stage this event belongs to. */
  stage: EngineStage;
  /** Boundary events in v1; `"progress"` is reserved and never emitted yet. */
  kind: EngineProgressKind;
  /** Items completed within the stage. Only on `"progress"` events (reserved). */
  completed?: number;
  /** Total items in the stage, when known. Only on `"progress"` events (reserved). */
  total?: number;
}

/**
 * Options for {@link indexProject}.
 *
 * Source seam note: `projectDirectory` is the sole v1 source, matching the
 * parser's own `ParseOptions`. Cloud sources land additively — this field
 * relaxes to optional and a discriminated `source` union field is added beside
 * it, with exactly-one-of validated at run time — so existing callers keep
 * compiling and behaving unchanged. Options interfaces here are only ever
 * constructed by callers (never implemented), which is what makes that
 * relaxation non-breaking.
 */
export interface EngineOptions {
  /**
   * Path to the local Java project directory to index. A relative path
   * resolves against the process working directory.
   */
  projectDirectory: string;
  /**
   * Output root for both artifacts: `graph.json` and `index/` are written
   * inside it. Defaults to `<projectDirectory>/.repohive`. A blank or
   * whitespace-only value means unset (same convention as the parser's
   * `outputPath`).
   */
  outputDirectory?: string;
  /**
   * Directory-name segments to exclude from source collection, passed through
   * to the parser. Omitted uses the parser's default exclusion list; an empty
   * set includes everything.
   */
  excludedSegments?: ReadonlySet<string>;
  /**
   * Grouping configuration, passed through to core untouched. Core resolves it
   * over its defaults and validates it at the start of the group stage; an
   * invalid config therefore surfaces as a group-stage `INVALID_CONFIG` failure
   * (after the parse has run — core does not export its config validator, so
   * the engine cannot pre-flight this; recorded as a follow-up candidate).
   */
  grouping?: PartialGroupingConfig;
  /**
   * Parse-stage read concurrency (an internal knob, deliberately NOT a CLI
   * flag in v1). Validated now — an integer >= 1 — so a nonsense value fails
   * today rather than when the knob becomes live. **Accepted but inert in this
   * release**: the parser prefetch it drives is wired up in a follow-up change
   * on this package's branch; until then the value has no effect.
   */
  concurrency?: number;
  /**
   * Progress callback. Lives in options rather than as a parameter so the
   * public signature stays `indexProject(options, deps)` — the house
   * dependency-injection pattern — and mirroring how the parser's collector
   * already threads callbacks through its options object. v1 fires coarse
   * stage-boundary events only: parse start/complete, group start/complete; a
   * failing stage emits `start` but no `complete`. A throwing callback aborts
   * the run through the `INTERNAL_ERROR` backstop.
   */
  onProgress?: (event: EngineProgressEvent) => void;
}

/**
 * What the engine needs back from the parse stage: the parser's `ParseSuccess`,
 * plus an optional in-memory graph.
 *
 * `parseProject` populates `graph` with the exact document it wrote, so the
 * default pipeline hands the graph over in memory and the `graph.json`
 * read-back never runs. The field stays optional because it is the seam: a
 * `parse` dependency that returns no graph (a stub, or a source that only
 * produces a file) still works, through the read-back branch.
 */
export interface EngineParseSuccess extends ParseSuccess {
  /** The parsed graph, when the parse stage can hand it over in memory. */
  graph?: RawDependencyGraph;
}

/**
 * The collaborators {@link indexProject} depends on. All are injectable so the
 * sequencing, error discrimination, timing, and directory-preparation behavior
 * can be tested without the real pipeline or filesystem; the defaults
 * ({@link defaultEngineDeps}) wire the real components.
 */
export interface EngineDeps {
  /** Stage 1. Defaults to `@repohive/parser`'s `parseProject`. */
  parse(options: ParseOptions): Promise<ParseResult<EngineParseSuccess, ParseError>>;
  /**
   * Read a `graph.json` from disk. Used only when the parse stage returns no
   * in-memory graph. Defaults to core's `readGraphFile`.
   */
  readGraph(graphPath: string): CoreResult<RawDependencyGraph>;
  /**
   * Stage 2: group and serialize the five-file index. Defaults to core's
   * `groupGraphToIndex`. Callers needing a custom `CommunityDetector` inject a
   * wrapper here; the engine itself always uses core's default detector.
   */
  group(
    graph: RawDependencyGraph,
    outDir: string,
    config?: PartialGroupingConfig,
  ): CoreResult<GroupingOutput>;
  /**
   * True when `candidatePath` exists and is a directory. Guards output-root
   * creation (see the module docstring, step 2).
   */
  isDirectory(candidatePath: string): boolean;
  /** Create a directory and any missing parents. Throws on failure. */
  ensureDirectory(directoryPath: string): void;
  /**
   * Monotonic clock in milliseconds, for the returned durations. Defaults to
   * `performance.now`. Never a wall clock: timing must not be able to reach an
   * artifact, and monotonicity keeps durations meaningful across clock
   * adjustments.
   */
  now(): number;
}

/** Build the default collaborators wired to the real components. */
export function defaultEngineDeps(): EngineDeps {
  return {
    parse: parseProject,
    readGraph: readGraphFile,
    group: groupGraphToIndex,
    isDirectory: (candidatePath) => {
      try {
        return statSync(candidatePath).isDirectory();
      } catch {
        return false;
      }
    },
    ensureDirectory: (directoryPath) => {
      mkdirSync(directoryPath, { recursive: true });
    },
    now: () => performance.now(),
  };
}

/**
 * Resolve the output root: the caller's `outputDirectory` when provided and
 * non-blank, otherwise `.repohive` inside the project directory. Both resolve
 * relative paths against the process working directory (standard library
 * behavior; the packaged CLI passes absolute paths).
 */
function resolveOutputRoot(options: EngineOptions): string {
  const custom = options.outputDirectory;
  if (custom !== undefined && custom.trim().length > 0) {
    return path.resolve(custom);
  }
  return path.resolve(options.projectDirectory, DEFAULT_OUTPUT_DIRECTORY_NAME);
}

/** Fire a progress event when the caller registered a callback. */
function emit(options: EngineOptions, stage: EngineStage, kind: EngineProgressKind): void {
  options.onProgress?.({ stage, kind });
}

/**
 * Run the full pipeline — parse then group — over a local Java project.
 *
 * See the module docstring for the sequence, the failure semantics of each
 * stage, and the artifact layout. On success, `<outputRoot>/graph.json` and
 * `<outputRoot>/index/` (five files) exist and are exactly what the parser and
 * core wrote: the engine adds no artifact of its own and introduces no ordering
 * or nondeterminism, so artifacts stay byte-identical across runs over
 * identical input.
 *
 * @param options the project directory and optional output root, grouping
 *   config, exclusions, concurrency, and progress callback.
 * @param deps injectable collaborators (defaults to the real components).
 * @returns an {@link EngineResult}: the success value, or a failure tagged with
 *   the stage that produced it, carrying that stage's native errors.
 */
export async function indexProject(
  options: EngineOptions,
  deps: EngineDeps = defaultEngineDeps(),
): Promise<EngineResult> {
  try {
    return await indexProjectUnguarded(options, deps);
  } catch (cause) {
    // Backstop, mirroring parseProject and groupGraph: the engine promises
    // errors-as-values, so no throw may cross this boundary.
    return {
      ok: false,
      stage: "engine",
      error: {
        code: "INTERNAL_ERROR",
        detail: `Unexpected internal error while indexing: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      },
    };
  }
}

async function indexProjectUnguarded(
  options: EngineOptions,
  deps: EngineDeps,
): Promise<EngineResult> {
  const startedAt = deps.now();

  // 1. Engine-level option validation, before any side effect.
  if (options.concurrency !== undefined) {
    if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) {
      return {
        ok: false,
        stage: "engine",
        error: {
          code: "INVALID_OPTIONS",
          field: "concurrency",
          detail: `concurrency: must be an integer >= 1 (got ${JSON.stringify(options.concurrency) ?? String(options.concurrency)})`,
        },
      };
    }
  }

  const outputRoot = resolveOutputRoot(options);
  const graphPath = path.join(outputRoot, GRAPH_FILE_NAME);
  const indexDirectory = path.join(outputRoot, INDEX_DIRECTORY_NAME);

  // 2. Prepare the output root, but only under a real project directory: when
  //    `projectDirectory` is invalid the parser must get to report its
  //    canonical input error, and the engine must not fabricate directories
  //    under a path that is about to be rejected.
  if (deps.isDirectory(options.projectDirectory)) {
    try {
      deps.ensureDirectory(outputRoot);
    } catch (cause) {
      return {
        ok: false,
        stage: "engine",
        error: {
          code: "OUTPUT_DIRECTORY_UNWRITABLE",
          path: outputRoot,
          detail: cause instanceof Error ? cause.message : String(cause),
        },
      };
    }
  }

  // 3. Parse. The parser resolves and validates the project directory itself;
  //    its errors pass through stage-tagged and unmodified.
  emit(options, "parse", "start");
  const parseStartedAt = deps.now();
  const parsed = await deps.parse({
    projectDirectory: options.projectDirectory,
    outputPath: graphPath,
    ...(options.excludedSegments !== undefined
      ? { excludedSegments: options.excludedSegments }
      : {}),
  });
  const parseMs = deps.now() - parseStartedAt;
  if (!parsed.ok) {
    return { ok: false, stage: "parse", errors: parsed.errors };
  }
  emit(options, "parse", "complete");

  // 4 + 5. Group. Acquiring the stage's input counts toward its duration: the
  //    read-back, when a parse dependency leaves one to do, is real work the
  //    group stage pays for. The default pipeline hands the graph over in
  //    memory, so that branch is skipped entirely.
  emit(options, "group", "start");
  const groupStartedAt = deps.now();
  let graph = parsed.value.graph;
  if (graph === undefined) {
    const read = deps.readGraph(parsed.value.outputPath);
    if (!read.ok) {
      return { ok: false, stage: "group", error: read.error, graphPath: parsed.value.outputPath };
    }
    graph = read.value;
  }
  const grouped = deps.group(graph, indexDirectory, options.grouping);
  const groupMs = deps.now() - groupStartedAt;
  if (!grouped.ok) {
    return { ok: false, stage: "group", error: grouped.error, graphPath: parsed.value.outputPath };
  }
  emit(options, "group", "complete");

  // 6. Assemble the success value from what the stages actually reported.
  const decisions = grouped.value.metadata.regionDecisions;
  let preserveCount = 0;
  for (const decision of decisions) {
    if (decision.action === "preserve") {
      preserveCount += 1;
    }
  }

  const value: EngineSuccess = {
    outputDirectory: outputRoot,
    graphPath: parsed.value.outputPath,
    indexDirectory,
    // v1 always parses: deciding "graph.json is current" correctly is the
    // snapshot-id seam, and a wrong skip silently serves a stale index. The
    // field is part of the stable result shape for the era when skipping lands.
    parseSkipped: false,
    durationMs: {
      parse: parseMs,
      group: groupMs,
      total: deps.now() - startedAt,
    },
    nodeCount: parsed.value.nodeCount,
    edgeCount: parsed.value.edgeCount,
    regionCount: decisions.length,
    preserveCount,
    reconstructCount: decisions.length - preserveCount,
    hierarchyDepth: grouped.value.metadata.hierarchyDepth,
    ...(parsed.value.crossScopeAmbiguities !== undefined
      ? { crossScopeAmbiguities: parsed.value.crossScopeAmbiguities }
      : {}),
    ...(parsed.value.excludedDirectoryCount !== undefined
      ? { excludedDirectoryCount: parsed.value.excludedDirectoryCount }
      : {}),
  };
  return { ok: true, value };
}
