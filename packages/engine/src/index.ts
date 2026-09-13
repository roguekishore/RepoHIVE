/**
 * @repohive/engine — pipeline orchestration for RepoHIVE.
 *
 * One async call, {@link indexProject}, runs the two batch stages in sequence:
 * parse (`@repohive/parser`, Java sources to `graph.json`) then group
 * (`@repohive/core`, `graph.json` to the five-file `index/` contract), writing
 * both artifacts under one output root (default `<projectDirectory>/.repohive`).
 *
 * Terminology: "the engine packages" refers to the engine side of the
 * engine/ecosystem boundary collectively (`shared`, `parser`, `core`, and this
 * package); "the engine orchestration package" refers to this package alone.
 *
 * This package sits on the engine side of the boundary: it imports only
 * `@repohive/shared`, `@repohive/parser`, and `@repohive/core`, and is imported
 * by ecosystem consumers (the CLI, the MCP server, the hosted service). It must
 * never import from `cli`, `web`, `ui`, `api-client`, or `types`.
 */

// The one public operation, its options, and its injectable collaborators.
export { defaultEngineDeps, indexProject } from "./orchestrator.js";
export type {
  EngineDeps,
  EngineOptions,
  EngineParseSuccess,
  EngineProgressEvent,
  EngineProgressKind,
} from "./orchestrator.js";

// Result and error model: a third result type discriminated by stage, carrying
// the parser's and the core's error shapes through unmodified.
export { describeEngineError, describeEngineFailure } from "./errors.js";
export type {
  EngineDurations,
  EngineError,
  EngineFailure,
  EngineFailureStage,
  EngineResult,
  EngineStage,
  EngineSuccess,
} from "./errors.js";

// Re-export the stage packages' public types that appear in this package's own
// signatures, so a consumer can type every part of an EngineResult without
// separate imports (the same convenience the parser extends for the shared
// contract). Consumers needing stage behavior (e.g. core's describeError or
// parseIndex) still import the stage package directly — that is allowed for
// every consumer allowed to import this one.
export type { ParseError, ParseErrorReason, ParseOptions, ParseSuccess } from "@repohive/parser";
export type { GroupingError, GroupingOutput, PartialGroupingConfig } from "@repohive/core";
export type {
  DependencyEdge,
  GraphNode,
  NodeId,
  RawDependencyGraph,
} from "@repohive/shared";
