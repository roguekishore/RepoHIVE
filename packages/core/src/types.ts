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
}

export interface PerLevelStats {
  level: number;
  groupNodeCount: number;
  leafNodeCount: number;
  leafEdgeCount: number;
  crossGroupEdgeCount: number;
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
}
