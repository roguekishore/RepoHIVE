/**
 * @repohive/core — the grouping algorithm.
 *
 * Pipeline: ingest → weight → assess → adaptively construct → build hierarchy
 * → emit the five-file index/. Consumes the @repohive/shared JSON contract.
 */

export { ingest } from "./ingestor.js";
export { computeWeights, DEFAULT_WEIGHT_COEFFICIENTS, type WeightCoefficients } from "./weights.js";
export { assignRegions, primaryRegionOfFile, owningFileOf, type RegionMap } from "./regions.js";
export { assess, DEFAULT_ASSESSMENT_CONFIG } from "./assessor.js";
export {
  LouvainCommunityDetector,
  relabelByContent,
  seededRng,
  type CommunityAssignment,
  type CommunityDetector,
  type CommunitySubgraph,
} from "./community.js";
export { construct, decideAction } from "./constructor.js";
export {
  aggregateCrossGroupEdges,
  buildHierarchy,
  DEFAULT_HIERARCHY_CONFIG,
  partitionChildren,
  validateHierarchyConfig,
} from "./hierarchy-builder.js";
export { buildMetadata, type MetadataInputs } from "./metadata.js";
export { indexFilePayloads, INDEX_FILE_NAMES, serializeIndex, type IndexFileName } from "./index-serializer.js";
export { parseIndex } from "./index-parser.js";
export { analyzeBlastRadius, type BlastRadius } from "./blast-radius.js";
export {
  DEFAULT_GROUPING_CONFIG,
  groupGraph,
  groupGraphToIndex,
  readGraphFile,
  resolveConfig,
  type GroupingConfig,
  type GroupingOutput,
  type PartialGroupingConfig,
} from "./orchestrator.js";
export { describeError, err, ok, type GroupingError, type Result } from "./errors.js";
export { compareEdgePairs, compareIds, sortByIds, sortEdges, sortIds, stableStringify } from "./canonical.js";
export { groupIdOf, repositoryIdOf } from "./group-id.js";
export type * from "./types.js";
