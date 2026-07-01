/**
 * Determinism verification harness (R9.1, R9.5, R9.6).
 *
 * Determinism is a hard requirement of the parser: parsing an identical project
 * MUST yield a byte-identical `graph.json` (identical SHA-256 digest). This
 * module provides {@link verifyDeterminism}, a small reusable harness that
 * parses a project directory `N` times and asserts that every emitted
 * `graph.json` shares the same SHA-256 digest.
 *
 * It is designed for two consumers:
 *
 * 1. **Property / end-to-end tests** — call {@link verifyDeterminism} with the
 *    real pipeline (or with injected {@link ParseDeps}, e.g. a shuffled-order
 *    collector) and assert `result.deterministic === true` (R9.1, R9.5).
 * 2. **A `npm run` demo aid for Review 1** — {@link runDeterminismDemo} wraps
 *    the harness for CLI use, printing the shared digest so a live demo can show
 *    "same input → same SHA-256" without a test runner.
 *
 * Each run writes to a distinct file inside a fresh temp directory, so a run can
 * never observe a previous run's output; the digest is computed from the bytes
 * actually written to disk (not the in-memory graph), so the check exercises the
 * true end-to-end serialization path.
 */

import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { parseProject, type ParseDeps, type ParseOptions } from "./orchestrator.js";
import type { ParseError } from "./errors.js";

/** The outcome of a single parse run inside the harness. */
export interface DeterminismRun {
  /** 1-based index of this run. */
  run: number;
  /** SHA-256 hex digest of the bytes written to `graph.json`. */
  digest: string;
  /** Absolute path to the `graph.json` this run wrote. */
  outputPath: string;
  /** Number of nodes the run reported. */
  nodeCount: number;
  /** Number of edges the run reported. */
  edgeCount: number;
}

/** A successful determinism verification: every run produced the same digest. */
export interface DeterminismSuccess {
  ok: true;
  /** True when all `runs` share the same digest (always true when `ok`). */
  deterministic: boolean;
  /** The single shared SHA-256 digest across all runs. */
  digest: string;
  /** Per-run details, in run order. */
  runs: DeterminismRun[];
}

/**
 * A failed determinism verification: either a run failed to parse, or the runs
 * disagreed on their digests.
 */
export interface DeterminismFailure {
  ok: false;
  deterministic: false;
  /** Human-readable reason for the failure. */
  reason: string;
  /** Per-run details for the runs that completed, in run order. */
  runs: DeterminismRun[];
  /** The distinct digests observed, when the failure was a digest mismatch. */
  distinctDigests?: string[];
  /** The parse errors, when a run failed to produce output. */
  parseErrors?: ParseError[];
}

/** The result of {@link verifyDeterminism}. */
export type DeterminismResult = DeterminismSuccess | DeterminismFailure;

/** Options for {@link verifyDeterminism}. */
export interface VerifyDeterminismOptions {
  /** Path to the Java project directory to parse. */
  projectDirectory: string;
  /**
   * How many times to parse the project. Must be at least 2 for the comparison
   * to be meaningful; defaults to 3.
   */
  runs?: number;
  /**
   * Optional injected pipeline collaborators, forwarded to {@link parseProject}.
   * Tests use this to inject a shuffled-order collector so byte-identity holds
   * across differing enumeration order (R9.5). Omit to use the real pipeline.
   *
   * A factory (rather than a value) is accepted so each run can receive a fresh
   * set of deps (e.g. a collector that reshuffles per run).
   */
  makeDeps?: (run: number) => ParseDeps;
}

/** Compute the SHA-256 hex digest of a UTF-8 file's raw bytes. */
async function digestOf(filePath: string): Promise<string> {
  const bytes = await nodeFs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Parse `projectDirectory` `runs` times and verify every emitted `graph.json`
 * has an identical SHA-256 digest (R9.1, R9.5, R9.6).
 *
 * Each run writes to its own file in a fresh temp directory so runs cannot
 * observe one another; the digest is taken from the on-disk bytes. Returns a
 * {@link DeterminismSuccess} when all runs succeed and agree, otherwise a
 * {@link DeterminismFailure} describing the first divergence. The harness never
 * throws for a parse failure or a mismatch — it reports them in the result.
 */
export async function verifyDeterminism(
  options: VerifyDeterminismOptions,
): Promise<DeterminismResult> {
  const runCount = options.runs ?? 3;
  const completed: DeterminismRun[] = [];

  const tempRoot = await nodeFs.mkdtemp(
    path.join(os.tmpdir(), "repohive-determinism-"),
  );

  try {
    for (let run = 1; run <= runCount; run += 1) {
      const outputPath = path.join(tempRoot, `graph.${run}.json`);
      const parseOptions: ParseOptions = {
        projectDirectory: options.projectDirectory,
        outputPath,
      };

      const result =
        options.makeDeps !== undefined
          ? await parseProject(parseOptions, options.makeDeps(run))
          : await parseProject(parseOptions);

      if (!result.ok) {
        return {
          ok: false,
          deterministic: false,
          reason: `Parse run ${run} failed with ${result.errors.length} error(s).`,
          runs: completed,
          parseErrors: result.errors,
        };
      }

      completed.push({
        run,
        digest: await digestOf(outputPath),
        outputPath,
        nodeCount: result.value.nodeCount,
        edgeCount: result.value.edgeCount,
      });
    }
  } finally {
    // The temp outputs are throwaway; clean them up regardless of outcome.
    await nodeFs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }

  const distinctDigests = [...new Set(completed.map((r) => r.digest))];
  if (distinctDigests.length !== 1) {
    return {
      ok: false,
      deterministic: false,
      reason:
        `Digests diverged across ${runCount} runs: ` +
        `${distinctDigests.length} distinct digests observed.`,
      runs: completed,
      distinctDigests,
    };
  }

  return {
    ok: true,
    deterministic: true,
    digest: distinctDigests[0]!,
    runs: completed,
  };
}

/**
 * CLI demo wrapper for Review 1: parse a project directory `runs` times and
 * print the shared SHA-256 digest (or a mismatch report). Resolves to a process
 * exit code (`0` deterministic, `1` otherwise) so it can drive an `npm run`
 * script.
 *
 * @param projectDirectory the Java project to parse; defaults to the checked-in
 *   `fixtures/sample-java-project` resolved relative to the repository root.
 * @param runs number of parse runs (default 3).
 */
export async function runDeterminismDemo(
  projectDirectory: string,
  runs = 3,
): Promise<number> {
  const result = await verifyDeterminism({ projectDirectory, runs });

  if (result.ok) {
    // eslint-disable-next-line no-console
    console.log(
      [
        `RepoHIVE parser — determinism check`,
        `  project : ${projectDirectory}`,
        `  runs    : ${result.runs.length}`,
        `  nodes   : ${result.runs[0]!.nodeCount}`,
        `  edges   : ${result.runs[0]!.edgeCount}`,
        `  sha-256 : ${result.digest}`,
        `  result  : DETERMINISTIC (identical digest across all runs)`,
      ].join("\n"),
    );
    return 0;
  }

  // eslint-disable-next-line no-console
  console.error(
    [
      `RepoHIVE parser — determinism check FAILED`,
      `  project : ${projectDirectory}`,
      `  reason  : ${result.reason}`,
      result.distinctDigests
        ? `  digests : ${result.distinctDigests.join(", ")}`
        : "",
      result.parseErrors
        ? `  errors  : ${result.parseErrors.map((e) => `${e.reason} (${e.path ?? "-"})`).join("; ")}`
        : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
  );
  return 1;
}
