/**
 * Result and error model for the parser (design: "Result and error model").
 *
 * The parser returns a discriminated {@link Result} rather than throwing across
 * component boundaries, so callers handle failure explicitly. Fatal input
 * errors return exactly one {@link ParseError} (R1.7); recoverable per-file
 * errors accumulate in a {@link ParseErrorCollector} and, if any were recorded,
 * the run returns them all and writes nothing (R10.4).
 */

/**
 * Discriminated result type. `ok: true` carries a value; `ok: false` carries
 * one or more errors.
 */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; errors: E[] };

/** Convenience constructor for a successful {@link Result}. */
export function ok<T, E>(value: T): Result<T, E> {
  return { ok: true, value };
}

/** Convenience constructor for a failed {@link Result}. */
export function err<T, E>(errors: E[]): Result<T, E> {
  return { ok: false, errors };
}

/**
 * The finite set of failure reasons the parser can report. Each maps to one or
 * more acceptance criteria (see the design's Error Handling table).
 */
export type ParseErrorReason =
  | "no-path-provided" // R1.3
  | "path-not-found" // R1.4
  | "path-not-directory" // R1.5
  | "directory-unreadable" // R1.6, R2.4
  | "no-java-files" // R2.5
  | "file-unreadable" // R10.2
  | "file-unparseable" // R10.1
  | "output-unwritable"; // R8.4, R8.5

/**
 * A structured parse error. Every error carries a human-readable message
 * describing the nature of the failure (R10.5) and, where the failure concerns
 * a specific file or directory, the path involved.
 */
export interface ParseError {
  /** Machine-readable failure category. */
  reason: ParseErrorReason;
  /** Human-readable nature of the failure (R10.5). */
  message: string;
  /** File or directory involved, when applicable (R1.4–6, R10.5). */
  path?: string;
}

/** Structure returned on a successful parse run. */
export interface ParseSuccess {
  /** Absolute path to the written `graph.json`. */
  outputPath: string;
  /** Number of nodes written. */
  nodeCount: number;
  /** Number of edges written. */
  edgeCount: number;
}

/**
 * Accumulates recoverable, per-file {@link ParseError}s during a parse run.
 *
 * Per-file failures (unreadable / unparseable files) are recorded here so
 * parsing of the remaining files can continue (R10.1, R10.2). After all parsing
 * completes, the orchestrator gates on {@link ParseErrorCollector.hasErrors};
 * if any error was recorded the run returns every error and writes nothing
 * (R10.4).
 */
export class ParseErrorCollector {
  private readonly collected: ParseError[] = [];

  /** Record a recoverable parse error. */
  add(error: ParseError): void {
    this.collected.push(error);
  }

  /** True when at least one error has been recorded. */
  hasErrors(): boolean {
    return this.collected.length > 0;
  }

  /** A defensive copy of all recorded errors, in insertion order. */
  errors(): ParseError[] {
    return [...this.collected];
  }
}

/** Build a {@link ParseError} for the given reason. */
export function makeError(
  reason: ParseErrorReason,
  message: string,
  path?: string,
): ParseError {
  return path === undefined ? { reason, message } : { reason, message, path };
}
