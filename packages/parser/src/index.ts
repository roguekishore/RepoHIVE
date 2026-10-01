/**
 * Public entry point for the RepoHIVE dependency graph parser
 * (`@repohive/parser`).
 *
 * The parser reads a local Java project, stitches per-file Tree-Sitter ASTs
 * into a single cross-file dependency graph, and writes one
 * contract-conforming `graph.json`. {@link parseProject} is the sole public
 * operation; the pipeline components remain internal.
 */

export { parseProject } from "./orchestrator.js";
export type { ParseOptions, ParseDeps } from "./orchestrator.js";

// In-memory source and the shared selection policy (hosting-1 Requirement 5).
export { findInvalidSourceEntry } from "./memory-source.js";
export type { SourceEntry, SourceEntryProblem } from "./memory-source.js";
export { DEFAULT_EXCLUDED_SEGMENTS, isSelectedSourcePath } from "./source-selection.js";
export type { SourceSelectionOptions } from "./source-selection.js";

// Determinism verification harness (R9): reusable from property tests and the
// `npm run demo:determinism` aid.
export {
  verifyDeterminism,
  runDeterminismDemo,
} from "./verify-determinism.js";
export type {
  VerifyDeterminismOptions,
  DeterminismResult,
  DeterminismSuccess,
  DeterminismFailure,
  DeterminismRun,
} from "./verify-determinism.js";

// Public result / error surface returned by parseProject.
export type {
  Result,
  ParseError,
  ParseErrorReason,
  ParseSuccess,
} from "./errors.js";

// Re-export the shared JSON contract so consumers can type the parser's output
// (the universal seam) without a separate import of `@repohive/shared`.
export type {
  NodeId,
  NodeKind,
  GraphNode,
  DependencyEdge,
  RawDependencyGraph,
} from "@repohive/shared";
