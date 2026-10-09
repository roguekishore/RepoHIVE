/**
 * Result and error model of the pipeline orchestration.
 *
 * The parser and the grouping core each have their own `Result` type, and the
 * two are deliberately incompatible: the parser's failure arm carries
 * `ParseError[]`, the core's carries a single `GroupingError`. Unifying them
 * would be a breaking change to both packages for no gain, so the engine
 * defines a third result type that discriminates by the stage that failed and
 * carries each stage's native error shape through unmodified. Callers switch on
 * `failure.stage` and get the underlying errors exactly as the stage reported
 * them.
 *
 * Errors are returned as values — never thrown — matching the house promise in
 * both underlying packages. {@link indexProject} wraps its body in a backstop
 * that converts any unexpected throw into an `INTERNAL_ERROR` value.
 */

import { describeError, type GroupingError, type GroupingOutput } from "@repohive/core";
import type { ParseError } from "@repohive/parser";

/** The two pipeline stages the engine orchestrates. Group includes writing the five-file index. */
export type EngineStage = "parse" | "group";

/**
 * Where a failure originated: one of the two pipeline stages, or `"engine"` for
 * failures of the orchestration layer itself (invalid options, an unpreparable
 * output directory, an unexpected internal throw). `"engine"` failures happen
 * outside both stages; when the value is `"engine"`, neither underlying package
 * reported an error.
 */
export type EngineFailureStage = EngineStage | "engine";

/**
 * Failures raised by the orchestration layer itself, as opposed to errors the
 * parse or group stage reported.
 *
 * - `INVALID_OPTIONS`: an engine-level option failed validation before any work
 *   started. Nothing was touched.
 * - `OUTPUT_DIRECTORY_UNWRITABLE`: the output root could not be created. Raised
 *   before the parse stage runs, so a bad output location costs an error
 *   message, not a completed parse. No artifact was written (the failed
 *   creation may leave empty directories behind).
 * - `INTERNAL_ERROR`: the backstop for an unexpected throw anywhere in the
 *   orchestration (including a throwing progress callback). Mirrors the
 *   equivalent backstops in the parser and the core.
 */
export type EngineError =
  | { code: "INVALID_OPTIONS"; field: string; detail: string }
  | { code: "OUTPUT_DIRECTORY_UNWRITABLE"; path: string; detail: string }
  | { code: "INTERNAL_ERROR"; detail: string };

/** Durations of one run, measured with a monotonic clock (`performance.now`). */
export interface EngineDurations {
  /** Milliseconds spent in the parse stage (the `deps.parse` call). */
  parse: number;
  /**
   * Milliseconds spent in the group stage, including acquiring its input. With
   * the default pipeline that input arrives in memory from the parse stage, so
   * this figure is grouping and serialization only; it additionally covers the
   * `graph.json` read-back when a `parse` dependency returns no in-memory graph.
   */
  group: number;
  /** Milliseconds for the whole `indexProject` call. Always >= parse + group. */
  total: number;
}

/**
 * Structure returned on a successful pipeline run.
 *
 * Timing data lives only here, on the in-memory result. It is never written to
 * any artifact: `graph.json` and `index/` stay byte-identical across runs over
 * identical input (the determinism rule in `docs/engineering/conventions.md`).
 */
export interface EngineSuccess {
  /** Absolute path of the output root holding `graph.json` and `index/`. */
  outputDirectory: string;
  /**
   * Absolute path of the written `graph.json`, as reported by the parse stage.
   * Absent when the run was asked not to write one (`writeGraph: false`).
   */
  graphPath?: string;
  /** Absolute path of the directory holding the five-file index contract. */
  indexDirectory: string;
  /**
   * Whether the parse stage was skipped because `graph.json` was already
   * current. **Always `false` in v1**: deciding "current" correctly is the
   * snapshot-id seam, and a wrong skip would silently serve a stale index, so
   * v1 always parses. The field exists so the result shape is stable when skip
   * semantics land in the snapshot-id era.
   */
  parseSkipped: boolean;
  /**
   * What the group stage produced, in memory: the `hierarchy` and `metadata`
   * that were serialized into `indexDirectory`. Lets a caller build views
   * without reading the index back. It is the same object the serializer
   * rendered, so it cannot disagree with the files.
   */
  groupingOutput: GroupingOutput;
  /** Stage and total durations. Result-only; never reaches an artifact. */
  durationMs: EngineDurations;
  /** Number of nodes written to `graph.json` (the parse stage's count). */
  nodeCount: number;
  /** Number of edges written to `graph.json` (the parse stage's count). */
  edgeCount: number;
  /** Number of regions the grouping stage decided over (`metadata.regionDecisions.length`). */
  regionCount: number;
  /**
   * Raw count of regions whose recorded action is `"preserve"`. Raw means it
   * counts every decision, including degenerate regions scored by rule; for
   * per-region detail read `metadata.json` (`regionDecisions`).
   */
  preserveCount: number;
  /** Raw count of regions whose recorded action is `"reconstruct"`. Same caveat as `preserveCount`. */
  reconstructCount: number;
  /** Levels from the Repository node to the deepest leaf (`metadata.hierarchyDepth`). */
  hierarchyDepth: number;
  /**
   * Cross-source-root resolution ambiguities the parse stage recorded. Omitted
   * when none occurred, mirroring the parser's own field-omission semantics.
   */
  crossScopeAmbiguities?: number;
  /** Directories the parse stage's collector skipped by exclusion policy. Omitted when none. */
  excludedDirectoryCount?: number;
  /** Files the parse stage left out under `tolerateFileErrors`, with the reason for each. Omitted when none. */
  skippedFiles?: readonly ParseError[];
}

/**
 * The failure arms of {@link EngineResult}, discriminated by `stage`.
 *
 * - `"engine"`: the orchestration failed before, between, or around the stages.
 *   Nothing was written unless `error.code` is `INTERNAL_ERROR`, in which case
 *   whatever the completed stages wrote remains on disk and valid.
 * - `"parse"`: the parse stage failed. The parser guarantees no partial
 *   `graph.json` (a prior valid file is left byte-for-byte intact), and the
 *   group stage never ran, so the previous `index/` is also untouched.
 * - `"group"`: the group stage (including the `graph.json` read-back and the
 *   index write) failed. Unless the run skipped the graph write
 *   (`writeGraph: false`), `graph.json` WAS written — `graphPath` names it, and
 *   a `group`-only re-run can start from it. The index serializer stages all five
 *   files before promoting, so an existing `index/` survives every failure that
 *   happens before promotion begins; only a failure inside the five-rename
 *   promotion window can leave a mixed set (a recorded, accepted design bound).
 */
export type EngineFailure =
  | { ok: false; stage: "engine"; error: EngineError }
  | { ok: false; stage: "parse"; errors: readonly ParseError[] }
  | { ok: false; stage: "group"; error: GroupingError; graphPath?: string };

/** Discriminated result of {@link indexProject}: success value or stage-tagged failure. */
export type EngineResult = { ok: true; value: EngineSuccess } | EngineFailure;

/** Render an engine-level error as a human-readable one-line message. */
export function describeEngineError(error: EngineError): string {
  switch (error.code) {
    case "INVALID_OPTIONS":
      return `invalid options: ${error.detail}`;
    case "OUTPUT_DIRECTORY_UNWRITABLE":
      return `could not prepare output directory ${error.path}: ${error.detail}`;
    case "INTERNAL_ERROR":
      return `internal error: ${error.detail}`;
  }
}

/**
 * Render any failure arm as a human-readable one-line message (CLI/log aid).
 * Parse failures are summarized as the first error plus a count, because a
 * parse failure can carry one error per source file; callers wanting the full
 * list read `failure.errors` directly. Group failures render through core's own
 * `describeError`, so the message matches what core consumers already see.
 */
export function describeEngineFailure(failure: EngineFailure): string {
  switch (failure.stage) {
    case "engine":
      return describeEngineError(failure.error);
    case "parse": {
      const first = failure.errors[0];
      if (first === undefined) {
        return "parse failed";
      }
      const rest = failure.errors.length - 1;
      return rest > 0
        ? `parse failed: ${first.message} (and ${rest} more error${rest === 1 ? "" : "s"})`
        : `parse failed: ${first.message}`;
    }
    case "group":
      return `group failed: ${describeError(failure.error)}`;
  }
}
