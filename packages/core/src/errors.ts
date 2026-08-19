/**
 * Error model of the grouping algorithm.
 *
 * Errors are returned as values via `Result<T>` — never thrown — so every
 * error path is part of the type and testable as a value. The pipeline fails
 * fast and atomically: a stage that detects invalid input returns an error
 * and produces no partial output.
 */

import type { NodeId } from "@repohive/shared";

/**
 * The discriminated error union from the design's Error Handling table.
 *
 * Two additions beyond the design's table:
 * - `INVALID_CONFIG` carries Requirement 6.6/6.8 configuration-bounds
 *   violations as a value instead of a thrown TypeError.
 * - `INVALID_DEFINED_IN_FILE` extends Requirement 1's structural validation
 *   to the shared contract's definedInFile invariant (class/function nodes
 *   declare an existing `file` node) — without it, contract-violating input
 *   silently corrupts the hierarchy downstream.
 */
export type GroupingError =
  | { code: "NO_GRAPH" }
  | { code: "EMPTY_GRAPH" }
  | { code: "DUPLICATE_NODE"; nodeId: NodeId }
  | { code: "DANGLING_EDGE"; nodeId: NodeId }
  | { code: "INVALID_DEFINED_IN_FILE"; nodeId: NodeId; detail: string }
  | { code: "NODE_NOT_FOUND"; nodeId: NodeId }
  | { code: "EMPTY_NODE_ID" }
  | { code: "MISSING_FILES"; files: string[] }
  | { code: "MALFORMED_FILE"; file: string; detail: string }
  | { code: "WRITE_FAILED"; file: string }
  | { code: "INVALID_CONFIG"; detail: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: GroupingError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(error: GroupingError): Result<T> {
  return { ok: false, error };
}

/** Render an error as a human-readable one-line message (CLI/demo aid). */
export function describeError(error: GroupingError): string {
  switch (error.code) {
    case "NO_GRAPH":
      return "no dependency graph was provided";
    case "EMPTY_GRAPH":
      return "the dependency graph contains zero nodes";
    case "DUPLICATE_NODE":
      return `duplicate node identifier: ${error.nodeId}`;
    case "DANGLING_EDGE":
      return `edge references a missing node identifier: ${error.nodeId}`;
    case "INVALID_DEFINED_IN_FILE":
      return `node ${error.nodeId} has an invalid definedInFile: ${error.detail}`;
    case "NODE_NOT_FOUND":
      return `node not found: ${error.nodeId}`;
    case "EMPTY_NODE_ID":
      return "no node identifier was provided";
    case "MISSING_FILES":
      return `missing index files: ${error.files.join(", ")}`;
    case "MALFORMED_FILE":
      return `malformed index file ${error.file}: ${error.detail}`;
    case "WRITE_FAILED":
      return `could not write index file: ${error.file}`;
    case "INVALID_CONFIG":
      return `invalid configuration: ${error.detail}`;
  }
}
