/**
 * Metadata accumulator (Requirements 5, 11.3, 11.4): assemble the audit
 * record — boundary, per-metric weights, k_cohesion, per-Region decisions —
 * plus the scalability statistics computed deterministically from the
 * Hierarchy (per-level node/edge counts, total Cross_Group_Edges, average
 * branching factor).
 */

import type { Hierarchy, Metadata, MetricWeights, PerLevelStats, RegionDecision } from "./types.js";

export interface MetadataInputs {
  structuralQualityBoundary: number;
  metricWeights: MetricWeights;
  cohesionSquashConstant: number;
  regionDecisions: RegionDecision[];
}

export function buildMetadata(hierarchy: Hierarchy, inputs: MetadataInputs): Metadata {
  const perLevelMap = new Map<number, PerLevelStats>();
  const statsAt = (level: number): PerLevelStats => {
    let stats = perLevelMap.get(level);
    if (!stats) {
      stats = { level, groupNodeCount: 0, leafNodeCount: 0, leafEdgeCount: 0, crossGroupEdgeCount: 0 };
      perLevelMap.set(level, stats);
    }
    return stats;
  };

  let groupNodeTotal = 0;
  let groupChildTotal = 0;
  for (const [, node] of hierarchy.nodes) {
    const stats = statsAt(node.level);
    if (node.kind === "group" || node.kind === "repository") {
      stats.groupNodeCount += 1;
      groupNodeTotal += 1;
      groupChildTotal += node.childIds.length;
    } else {
      stats.leafNodeCount += 1;
    }
  }

  // A leaf edge is counted at the level of its deeper endpoint; a
  // Cross_Group_Edge at its recorded (source-group) level.
  for (const edge of hierarchy.leafEdges) {
    const sourceLevel = hierarchy.nodes.get(edge.source)?.level ?? 0;
    const targetLevel = hierarchy.nodes.get(edge.target)?.level ?? 0;
    statsAt(Math.max(sourceLevel, targetLevel)).leafEdgeCount += 1;
  }
  for (const edge of hierarchy.crossGroupEdges) {
    statsAt(edge.level).crossGroupEdgeCount += 1;
  }

  const perLevel = [...perLevelMap.values()].sort((a, b) => a.level - b.level);

  return {
    structuralQualityBoundary: inputs.structuralQualityBoundary,
    metricWeights: inputs.metricWeights,
    cohesionSquashConstant: inputs.cohesionSquashConstant,
    regionDecisions: inputs.regionDecisions,
    nodeCount: hierarchy.nodes.size,
    edgeCount: hierarchy.leafEdges.length + hierarchy.crossGroupEdges.length,
    hierarchyDepth: hierarchy.depth,
    perLevel,
    totalCrossGroupEdges: hierarchy.crossGroupEdges.length,
    averageBranchingFactor: groupNodeTotal > 0 ? groupChildTotal / groupNodeTotal : 0,
  };
}
