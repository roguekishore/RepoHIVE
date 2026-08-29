/**
 * Internal working types of the grouping algorithm, matching the design's
 * Data Models. The on-disk input contract (GraphNode, DependencyEdge,
 * RawDependencyGraph) comes from @repohive/shared and is never redefined.
 */

import type { MultiDirectedGraph } from "graphology";
import type { DependencyEdge, GraphNode, NodeId } from "@repohive/shared";

export type RegionId = string;

export type Action = "preserve" | "reconstruct";

/** Validated, fully-loaded input graph (output of the Graph_Ingestor). */
export interface DependencyModel {
  /** Every input node, in canonical (id-ascending) order. */
  nodes: GraphNode[];
  nodesById: Map<NodeId, GraphNode>;
  /** Every input edge, in canonical (source, target)-ascending order. */
  edges: DependencyEdge[];
  /** graphology mirror of the node/edge sets for traversal utilities. */
  graph: MultiDirectedGraph;
}

/** DependencyModel whose every edge carries a computed strength. */
export interface WeightedModel extends DependencyModel {
  /** Same edges as `edges`, each with `strength` filled (≥ 0, finite). */
  weightedEdges: Array<DependencyEdge & { strength: number }>;
}

export interface RegionScore {
  regionId: RegionId;
  /** File-node ids owned by this Region (canonical order). */
  nodeIds: NodeId[];
  cohesion: number;
  coupling: number;
  modularity?: number;
  /** Combined Structural_Quality_Score in [0, 1]. */
  score: number;
  /** True when the degenerate-case rule (Req 3.9) assigned the score. */
  degenerate: boolean;
}

export interface RegionAssessment {
  regions: RegionScore[];
  /** Total, non-overlapping Primary_Region ownership over File nodes. */
  primaryRegionOf: Map<NodeId, RegionId>;
  /** The per-metric weights actually used (recorded in metadata, Req 3.7). */
  metricWeights: MetricWeights;
  cohesionSquashConstant: number;
}

export interface MetricWeights {
  cohesion: number;
  coupling: number;
  modularity?: number;
}

export interface AssessmentConfig {
  weights: MetricWeights;
  computeModularity: boolean;
  cohesionSquashConstant: number;
  /** Score assigned to degenerate Regions (<2 nodes or 0 internal edges). */
  degenerateScore: number;
}

export interface ConstructionConfig {
  structuralQualityBoundary: number;
  overrides?: Map<RegionId, Action>;
  communityDetectionSeed: number;
}

export interface RegionDecision {
  regionId: RegionId;
  cohesion: number;
  coupling: number;
  modularity?: number;
  score: number;
  action: Action;
  /** The automatically computed decision, recorded even when overridden. */
  automaticAction: Action;
  userOverridden: boolean;
  /** |score − boundary| (Req 5.4). */
  decisionConfidence: number;
  /**
   * The group node ids this decision produced, in canonical order (Gap 12).
   *
   * Joins the audit record to the tree in the decision→groups direction, so a
   * consumer can go from "this region was reconstructed with score 0.31" to the
   * boxes on screen — which is what makes the adaptive contribution visible
   * rather than merely recorded. Optional so older indexes still parse.
   */
  groupIds?: NodeId[];
}

/** One produced group of File nodes within a Region's result. */
export interface RegionGroup {
  /** File-node ids in canonical order. */
  fileIds: NodeId[];
}

export interface ConstructionResult {
  /** Per-Region group results; every File node lands in exactly one group. */
  regionGroups: Map<RegionId, RegionGroup[]>;
  decisions: RegionDecision[];
}

export interface HierarchyConfig {
  /** Integer 2..50, default 20 (Req 6.6). */
  maxGroupSize: number;
  /** Integer 2..maxGroupSize (Req 6.8). */
  minPartitionThreshold: number;
}

export interface HierarchyNode {
  id: NodeId;
  kind: GraphNode["kind"];
  /** 0 = Repository. */
  level: number;
  parentId: NodeId | null;
  /** Sorted ascending by child id (Req 7.5). */
  childIds: NodeId[];
  /**
   * The Primary_Region this group came from (Gap 12). Purely additive
   * provenance: a group id is a content hash, so without it a consumer can only
   * show `g_<hash>` and has no way to tell which package a box represents.
   *
   * Omitted on the Repository node and on the intermediate wrapper groups that
   * exist only to bound the Repository's fan-out — those correspond to no
   * region, and consumers must handle that.
   */
  regionId?: RegionId;
  /**
   * This group's index within its region's canonical group list (Gap 12).
   *
   * The piece a consumer cannot derive: when a region is reconstructed into
   * several communities, or split by `maxGroupSize` into slices, the resulting
   * sibling groups share a `regionId` and differ only by content hash. The
   * ordinal is a pure function of the already-canonical iteration order — no
   * counter spans the run — so it stays deterministic.
   *
   * Omitted wherever `regionId` is.
   */
  ordinal?: number;
}

export interface CrossGroupEdge {
  /** A Group_Node id. */
  source: NodeId;
  /** A Group_Node id. */
  target: NodeId;
  level: number;
  /** Sum of aggregated leaf-edge strengths (Req 8.4). */
  weight: number;
}

export interface Hierarchy {
  repositoryId: NodeId;
  nodes: Map<NodeId, HierarchyNode>;
  /** Original leaf-node attributes, for serialization and consumers. */
  leafAttributes: Map<NodeId, GraphNode>;
  /** Every input edge, direction and strength preserved (Req 8.1). */
  leafEdges: Array<DependencyEdge & { strength: number }>;
  crossGroupEdges: CrossGroupEdge[];
  /** Levels from the Repository node to the deepest leaf (Req 9.4). */
  depth: number;
  /**
   * Group node ids produced per Region, in canonical order (Gap 12).
   *
   * In-memory only, and produced by `buildHierarchy` for `groupGraph` to fold
   * into `regionDecisions[].groupIds`. It is **absent** on a Hierarchy returned
   * by `parseIndex`: on the read side the same association is carried by that
   * metadata field and by each node's own `regionId`, so nothing rebuilds it.
   */
  groupIdsOfRegion?: Map<RegionId, NodeId[]>;
}

export interface PerLevelStats {
  level: number;
  groupNodeCount: number;
  leafNodeCount: number;
  leafEdgeCount: number;
  crossGroupEdgeCount: number;
}

/**
 * The fully-resolved configuration a run actually used (Gap 22).
 *
 * `metadata.json` recorded the boundary, metric weights, squash constant and
 * decisions, but not `maxGroupSize`, `minPartitionThreshold`, the seed, the
 * weight coefficients or `degenerateScore` — so a run's *hierarchy shape* could
 * not be reproduced from its own audit record, even though Req 7.1 states its
 * determinism guarantee "with identical configuration".
 *
 * The **resolved** config is emitted rather than the caller's partial one: only
 * a fully-defaulted record is a reproduction recipe. A content hash would be
 * smaller but useless for actually re-running without the original invocation,
 * which is the one purpose this field has.
 */
export interface RunConfiguration {
  structuralQualityBoundary: number;
  communityDetectionSeed: number;
  weightCoefficients: {
    importCoefficient: number;
    callCoefficient: number;
    sharedTypeCoefficient: number;
  };
  assessment: {
    weights: MetricWeights;
    computeModularity: boolean;
    cohesionSquashConstant: number;
    degenerateScore: number;
  };
  hierarchy: {
    maxGroupSize: number;
    minPartitionThreshold: number;
  };
  /** Per-Region user overrides, as a plain object so it serializes canonically. */
  overrides: Record<string, Action>;
}

export interface Metadata {
  structuralQualityBoundary: number;
  metricWeights: MetricWeights;
  cohesionSquashConstant: number;
  regionDecisions: RegionDecision[];
  nodeCount: number;
  edgeCount: number;
  hierarchyDepth: number;
  perLevel: PerLevelStats[];
  totalCrossGroupEdges: number;
  averageBranchingFactor: number;
  /**
   * The full resolved configuration (Gap 22). Optional so that indexes written
   * before this field existed still parse.
   */
  configuration?: RunConfiguration;
}
