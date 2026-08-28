/**
 * Structural_Quality_Assessor (Requirement 3): identify Regions, assign each
 * File node its Primary_Region, and score every Region on a graded [0, 1]
 * scale from Cohesion and Coupling (optionally Newman modularity as a
 * secondary signal).
 *
 * Metric definitions (design):
 * - Cohesion (3.3)  = Σ strength of intra-Region edges / Region node count.
 *   Scale-relative Phase-1 simplification (see design note).
 * - Coupling (3.4)  = Σ strength of boundary-crossing edges / total strength
 *   incident to the Region's nodes — a native [0, 1] ratio.
 * - Modularity (3.5, optional) = Newman Q of the Region partition over the
 *   strength-weighted graph, via graphology-metrics. Q is a partition-level
 *   value; it is recorded per Region as that shared value (secondary,
 *   auditable signal — never the primary discriminator; see requirements
 *   glossary on circularity).
 *
 * Normalization to a common scale (3.6):
 * - cohesion_norm  = cohesion / (cohesion + k_cohesion)    (bounded squash)
 * - coupling_norm  = clamp(coupling, 0, 1), used as (1 − coupling_norm)
 * - modularity_norm = clamp((Q + 0.5) / 1.5, 0, 1)          (affine map)
 * Score = weighted sum of the normalized inputs with the ACTIVE weights
 * renormalized to sum to 1.0 (modularity weight dropped when not computed),
 * clamped to [0, 1] for float safety. No min-max across the run's Regions.
 *
 * Degenerate rule (3.9): a Region with < 2 nodes or 0 internal edges receives
 * the documented neutral score (default 0.0) — never NaN/undefined.
 *
 * Edges are attributed to Regions at FILE granularity: every edge endpoint is
 * mapped to its owning File node (classes/functions → definedInFile), then the
 * edge is intra-Region iff both owning files share the Region.
 */

import { createRequire } from "node:module";
import { UndirectedGraph } from "graphology";
import type { NodeId } from "@repohive/shared";

// graphology-metrics is a CJS package with ESM-style typings; under NodeNext
// the reliable way to load its subpath is createRequire with an explicit type.
type ModularityFn = (
  graph: UndirectedGraph,
  options?: { getNodeCommunity?: (node: string, attributes: Record<string, unknown>) => string | number }
) => number;
const require = createRequire(import.meta.url);
const modularityMetric = require("graphology-metrics/graph/modularity.js") as ModularityFn;
import { assignRegions, owningFileOf } from "./regions.js";
import type {
  AssessmentConfig,
  MetricWeights,
  RegionAssessment,
  RegionId,
  RegionScore,
  WeightedModel,
} from "./types.js";

export const DEFAULT_ASSESSMENT_CONFIG: AssessmentConfig = {
  weights: { cohesion: 0.4, coupling: 0.4, modularity: 0.2 },
  computeModularity: false,
  cohesionSquashConstant: 1.0,
  degenerateScore: 0.0,
};

export function assess(model: WeightedModel, config: AssessmentConfig = DEFAULT_ASSESSMENT_CONFIG): RegionAssessment {
  const { members, primaryRegionOf } = assignRegions(model);

  // Per-region strength accumulators at file granularity.
  const internal = new Map<RegionId, number>();
  const crossing = new Map<RegionId, number>();
  const internalEdgeCount = new Map<RegionId, number>();

  for (const edge of model.weightedEdges) {
    const sourceNode = model.nodesById.get(edge.source);
    const targetNode = model.nodesById.get(edge.target);
    if (!sourceNode || !targetNode) {
      continue;
    }
    const sourceFile = owningFileOf(sourceNode, model.nodesById);
    const targetFile = owningFileOf(targetNode, model.nodesById);
    if (sourceFile === null || targetFile === null) {
      continue;
    }
    const sourceRegion = primaryRegionOf.get(sourceFile);
    const targetRegion = primaryRegionOf.get(targetFile);
    if (sourceRegion === undefined || targetRegion === undefined) {
      continue;
    }
    if (sourceRegion === targetRegion) {
      if (sourceFile !== targetFile) {
        internal.set(sourceRegion, (internal.get(sourceRegion) ?? 0) + edge.strength);
        internalEdgeCount.set(sourceRegion, (internalEdgeCount.get(sourceRegion) ?? 0) + 1);
      }
      // Same-file edges (class→class within one file) carry no inter-file
      // structure signal and are excluded from region metrics.
    } else {
      crossing.set(sourceRegion, (crossing.get(sourceRegion) ?? 0) + edge.strength);
      crossing.set(targetRegion, (crossing.get(targetRegion) ?? 0) + edge.strength);
    }
  }

  const partitionModularity = config.computeModularity ? computePartitionModularity(model, primaryRegionOf) : undefined;

  const regions: RegionScore[] = [];
  for (const [regionId, nodeIds] of members) {
    const intra = internal.get(regionId) ?? 0;
    const cross = crossing.get(regionId) ?? 0;
    const intraCount = internalEdgeCount.get(regionId) ?? 0;

    const cohesion = nodeIds.length > 0 ? intra / nodeIds.length : 0;
    const incident = intra + cross;
    const coupling = incident > 0 ? cross / incident : 0;

    // Strength-aware degenerate rule (Req 3.9): a region is degenerate if it
    // has fewer than 2 nodes, zero internal edges, OR zero total intra-region
    // strength.  A subgraph with edges but no weight carries no signal for the
    // algorithm to use — scoring it normally would yield cohesion 0, coupling
    // 0, score 0.5, which sits on the default boundary and would cause the
    // same input to flip between preserve and reconstruct under a tiny boundary
    // change.  Both conditions are tested independently so either alone suffices.
    const degenerate = nodeIds.length < 2 || intraCount === 0 || intra <= 0;
    const modularity = partitionModularity;
    const score = degenerate
      ? clamp01(config.degenerateScore)
      : combineScore(cohesion, coupling, modularity, config);

    regions.push({
      regionId,
      nodeIds,
      cohesion,
      coupling,
      ...(modularity !== undefined ? { modularity } : {}),
      score,
      degenerate,
    });
  }

  return {
    regions,
    primaryRegionOf,
    metricWeights: activeWeights(config, partitionModularity),
    cohesionSquashConstant: config.cohesionSquashConstant,
  };
}

/**
 * The weights actually used, i.e. with modularity dropped when not computed.
 *
 * `computeModularity` being true is not enough: Q is undefined on an edgeless
 * projection and on one whose inter-file edges all carry zero strength, and in
 * those runs `combineScore` never applies the modularity weight. Reporting it
 * anyway contradicted Req 3.7's "weights **used**" and this function's own name
 * (Gap 22), and would have made a recorded run irreproducible from its metadata.
 */
function activeWeights(config: AssessmentConfig, modularity: number | undefined): MetricWeights {
  if (config.computeModularity && config.weights.modularity !== undefined && modularity !== undefined) {
    return { ...config.weights };
  }
  return { cohesion: config.weights.cohesion, coupling: config.weights.coupling };
}

function combineScore(
  cohesion: number,
  coupling: number,
  modularity: number | undefined,
  config: AssessmentConfig
): number {
  const k = config.cohesionSquashConstant;
  const cohesionNorm = cohesion / (cohesion + k);
  const couplingNorm = clamp01(coupling);
  const inputs: Array<{ weight: number; value: number }> = [
    { weight: config.weights.cohesion, value: cohesionNorm },
    { weight: config.weights.coupling, value: 1 - couplingNorm },
  ];
  if (modularity !== undefined && config.weights.modularity !== undefined) {
    inputs.push({ weight: config.weights.modularity, value: clamp01((modularity + 0.5) / 1.5) });
  }
  const totalWeight = inputs.reduce((sum, i) => sum + i.weight, 0);
  if (totalWeight <= 0) {
    return 0;
  }
  const score = inputs.reduce((sum, i) => sum + (i.weight / totalWeight) * i.value, 0);
  return clamp01(score);
}

/**
 * Newman modularity (Q) of the Region partition over an undirected,
 * strength-weighted file-level projection of the graph.
 */
function computePartitionModularity(
  model: WeightedModel,
  primaryRegionOf: Map<NodeId, RegionId>
): number | undefined {
  const projection = new UndirectedGraph();
  for (const [fileId, regionId] of primaryRegionOf) {
    projection.addNode(fileId, { community: regionId });
  }
  for (const edge of model.weightedEdges) {
    const sourceNode = model.nodesById.get(edge.source);
    const targetNode = model.nodesById.get(edge.target);
    if (!sourceNode || !targetNode) {
      continue;
    }
    const sourceFile = owningFileOf(sourceNode, model.nodesById);
    const targetFile = owningFileOf(targetNode, model.nodesById);
    if (sourceFile === null || targetFile === null || sourceFile === targetFile) {
      continue;
    }
    if (projection.hasEdge(sourceFile, targetFile)) {
      projection.updateEdgeAttribute(
        sourceFile,
        targetFile,
        "weight",
        (w: number | undefined) => (w ?? 0) + edge.strength
      );
    } else {
      projection.addEdge(sourceFile, targetFile, { weight: edge.strength });
    }
  }
  if (projection.size === 0) {
    // Modularity is undefined on an edgeless graph.
    return undefined;
  }
  // Newman Q divides by the total edge weight: a projection whose inter-file
  // edges all carry strength 0 would yield NaN. Treat it as "not computed"
  // (the modularity weight is then dropped and renormalized per design 3.6)
  // so no NaN ever reaches scores or metadata.
  let totalWeight = 0;
  projection.forEachEdge((_edge, attributes) => {
    totalWeight += (attributes.weight as number) ?? 0;
  });
  if (totalWeight <= 0) {
    return undefined;
  }
  const q = modularityMetric(projection, {
    getNodeCommunity: (_node, attributes) => attributes.community as string,
  });
  return Number.isFinite(q) ? q : undefined;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
