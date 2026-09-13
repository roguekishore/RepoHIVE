/**
 * The `--json` document contract.
 *
 * Machine-readable output is the primary output: the prose each command prints
 * without `--json` is a rendering of exactly these fields, never the other way
 * round. Anyone is free to script against this shape, which is why it is
 * defined in one module rather than assembled inline per command.
 *
 * Every document carries `schemaVersion`, the `command` it came from, and an
 * `ok` discriminant. Success carries `result`; failure carries `stage`, a
 * one-line `message`, and the stage's own structured error, passed through
 * unmodified from the engine, the parser or the core rather than reshaped.
 *
 * `stage` extends the engine's failure stages ("engine" | "parse" | "group")
 * with one CLI-level value, "usage": the request never ran because the command
 * line could not be turned into one. It pairs with exit code 2; every other
 * stage pairs with exit code 1.
 *
 * Not reproducible byte for byte: result documents carry measured durations, so
 * two runs over identical input differ. The on-disk artifacts under `.repohive/`
 * are the deterministic outputs; this document describes a run.
 */

import type { GroupingError } from "@repohive/core";
import { describeEngineFailure, type EngineError, type EngineFailure } from "@repohive/engine";
import type { ParseError } from "@repohive/parser";
import type { CliIo } from "./io.js";

/**
 * Bumped only when a field is renamed, removed or changes meaning. Adding a
 * field is not a bump: consumers must ignore fields they do not know.
 */
export const SCHEMA_VERSION = 1;

/** The four decided command names. `view` is declared but not shipped yet. */
export type CommandName = "index" | "parse" | "group" | "view";

/** Where the failure happened. "usage" is CLI-level; the rest are the engine's. */
export type FailureStage = "usage" | EngineFailure["stage"];

/**
 * Wall-clock cost of the stages that ran, in milliseconds, measured on a
 * monotonic clock. Result-only: durations never reach an artifact.
 */
export interface JsonDurations {
  parse?: number;
  group?: number;
  /** Always present, and always >= the sum of the stages above it. */
  total: number;
}

export interface JsonSuccessDocument<TResult> {
  schemaVersion: number;
  command: CommandName;
  ok: true;
  result: TResult;
}

/**
 * A failure document. `command` is null only when the failing argv named no
 * recognizable command at all.
 */
export type JsonFailureDocument = {
  schemaVersion: number;
  command: CommandName | null;
  ok: false;
  message: string;
} & (
  | { stage: "usage" }
  | { stage: "engine"; error: EngineError }
  | { stage: "parse"; errors: readonly ParseError[] }
  | { stage: "group"; error: GroupingError; graphPath: string }
);

export function successDocument<TResult>(
  command: CommandName,
  result: TResult,
): JsonSuccessDocument<TResult> {
  return { schemaVersion: SCHEMA_VERSION, command, ok: true, result };
}

/** The command line could not be turned into a request. Pairs with exit 2. */
export function usageFailureDocument(
  command: CommandName | null,
  message: string,
): JsonFailureDocument {
  return { schemaVersion: SCHEMA_VERSION, command, ok: false, stage: "usage", message };
}

/** A parse stage that ran and failed, carrying the parser's own error list. */
export function parseFailureDocument(
  command: CommandName,
  message: string,
  errors: readonly ParseError[],
): JsonFailureDocument {
  return { schemaVersion: SCHEMA_VERSION, command, ok: false, stage: "parse", message, errors };
}

/** A group stage that ran and failed, naming the graph it started from. */
export function groupFailureDocument(
  command: CommandName,
  message: string,
  error: GroupingError,
  graphPath: string,
): JsonFailureDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    command,
    ok: false,
    stage: "group",
    message,
    error,
    graphPath,
  };
}

/**
 * Render any engine failure as a document, preserving the stage discriminant
 * and the stage's native error shape. The message is the engine's own wording
 * so prose and JSON never disagree.
 */
export function engineFailureDocument(
  command: CommandName,
  failure: EngineFailure,
): JsonFailureDocument {
  const message = describeEngineFailure(failure);
  if (failure.stage === "parse") {
    return parseFailureDocument(command, message, failure.errors);
  }
  if (failure.stage === "group") {
    return groupFailureDocument(command, message, failure.error, failure.graphPath);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    command,
    ok: false,
    stage: "engine",
    message,
    error: failure.error,
  };
}

/** Write one JSON document to stdout. The only thing a `--json` run prints. */
export function emitJson(io: CliIo, document: unknown): void {
  io.log(JSON.stringify(document, null, 2));
}

/**
 * True when `--json` appears anywhere in argv.
 *
 * Scanned before the arguments are properly parsed so that a usage error
 * reports itself in JSON too. A caller asking for machine-readable output must
 * not get prose back just because it mistyped another flag.
 */
export function wantsJson(argv: readonly string[]): boolean {
  return argv.includes("--json");
}
