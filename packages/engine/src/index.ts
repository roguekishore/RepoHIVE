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
