/**
 * @repohive/mcp - read-only Model Context Protocol server over a produced
 * RepoHIVE index/ directory.
 *
 * Ecosystem package: imports @repohive/core (and @repohive/shared) directly;
 * engine packages never import from here. The server exposes what the engine
 * emitted - it never computes or re-derives scores, decisions or communities.
 *
 * Entry point: `dist/server.js` (bin: repohive-mcp). This module exports the
 * tool handlers and the index store for library and test use.
 */

export { buildIndexView, displayNameOf, isAssessed, stripRegionScheme } from "./view.js";
export type { DecisionSummary, IndexView, LeafEdge } from "./view.js";
export { createIndexStore } from "./store.js";
export type { IndexStore, LoadResult } from "./store.js";
export {
  blastRadius,
  findNode,
  hierarchyAtLevel,
  LIMITS,
  nodeDetails,
  regionDecisions,
  repositoryOverview,
} from "./tools.js";
export type {
  BlastRadiusInput,
  BlastRadiusResult,
  DecisionBrief,
  DecisionRecord,
  FindNodeInput,
  FindNodeResult,
  FoundNode,
  HierarchyAtLevel,
  HierarchyAtLevelInput,
  LevelNode,
  MatchedField,
  NodeDetails,
  NodeDetailsInput,
  RegionDecisionsInput,
  RegionDecisionsResult,
  RegionRef,
  ToolResult,
} from "./tools.js";
export { buildServer, resolveIndexDirFromArgs } from "./server.js";
export type { ResolveArgsResult } from "./server.js";
