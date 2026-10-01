/**
 * Adaptive_Hierarchy_Constructor (Requirements 4 and 5): decide preserve vs
 * reconstruct per Primary_Region by comparing its Structural_Quality_Score
 * against the Structural_Quality_Boundary, execute the chosen action, and
 * record complete decision metadata.
 *
 * - Preserve (4.2): score ≥ boundary → the Region's existing package/directory
 *   boundary becomes its single Group_Node (its File nodes stay together).
 * - Reconstruct (4.3): score < boundary → the injected CommunityDetector
 *   rebuilds the Region's groups over its nodes and strength-weighted edges,
 *   seeded for determinism.
 * - User overrides (4.6) replace the automatic decision; both the applied and
 *   the automatic action are recorded (5.6).
 * - Every File node lands in exactly one Region group result (4.5).
 */

import type { NodeId } from "@repohive/shared";
import { compareIds } from "./canonical.js";
import type { CommunityDetector, CommunitySubgraph } from "./community.js";
import { owningFileOf } from "./regions.js";
import type {
  Action,
  ConstructionConfig,
  ConstructionResult,
  RegionAssessment,
  RegionDecision,
  RegionGroup,
  WeightedModel,
} from "./types.js";

/** The pure boundary comparison (Req 4.1–4.3; reused by Property 18 replays). */
export function decideAction(score: number, boundary: number): Action {
  return score >= boundary ? "preserve" : "reconstruct";
}

export function construct(
  model: WeightedModel,
  assessment: RegionAssessment,
  config: ConstructionConfig,
  detector: CommunityDetector
): ConstructionResult {
  const regionGroups = new Map<string, RegionGroup[]>();
  const decisions: RegionDecision[] = [];

  // Decide every region's action first, so the edge list is bucketed once, and
  // only for the regions that will be reconstructed.
  const regions = assessment.regions.map((region) => {
    const automaticAction = decideAction(region.score, config.structuralQualityBoundary);
    const override = config.overrides?.get(region.regionId);
    return { region, automaticAction, override, action: override ?? automaticAction };
  });
  const edgesByRegion = bucketEdgesByRegion(
    model,
    regions.filter((entry) => entry.action === "reconstruct").map((entry) => entry.region),
  );

  // assessment.regions is in canonical Region order already; keep it so.
  for (const { region, automaticAction, override, action } of regions) {
    const groups =
      action === "preserve"
        ? [{ fileIds: [...region.nodeIds] }]
        : reconstructRegion(
            region.nodeIds,
            edgesByRegion.get(region.regionId) ?? [],
            config.communityDetectionSeed,
            detector,
          );

    regionGroups.set(region.regionId, groups);
    decisions.push({
      regionId: region.regionId,
      cohesion: region.cohesion,
      coupling: region.coupling,
      ...(region.modularity !== undefined ? { modularity: region.modularity } : {}),
      score: region.score,
      action,
      automaticAction,
      userOverridden: override !== undefined,
      decisionConfidence: Math.abs(region.score - config.structuralQualityBoundary),
    });
  }

  return { regionGroups, decisions };
}

/**
 * Bucket the file-level edges of every given region in ONE pass over
 * `model.weightedEdges`, instead of one pass per region.
 *
 * A region's edges are those whose two owning files are both members of it and
 * differ. The per-region scan this replaces made grouping cost edges x regions
 * (about 3 s on Broadleaf's 14,325 edges and 502 regions, and quadratic growth
 * on a repository an order of magnitude larger). Each bucket receives its edges
 * in their original `weightedEdges` order, which is the order the community
 * detector has always been handed, so output is unchanged. A file in more than
 * one region's membership (the types do not forbid it) lands the edge in every
 * region holding both endpoints, exactly as the per-region membership test did.
 */
function bucketEdgesByRegion(
  model: WeightedModel,
  regions: readonly RegionAssessment["regions"][number][],
): Map<string, CommunitySubgraph["edges"]> {
  const buckets = new Map<string, CommunitySubgraph["edges"]>();
  if (regions.length === 0) {
    return buckets;
  }
  const regionsOfFile = new Map<NodeId, string[]>();
  for (const region of regions) {
    buckets.set(region.regionId, []);
    for (const fileId of region.nodeIds) {
      const list = regionsOfFile.get(fileId);
      if (list) {
        if (!list.includes(region.regionId)) {
          list.push(region.regionId);
        }
      } else {
        regionsOfFile.set(fileId, [region.regionId]);
      }
    }
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
    const sourceRegions = regionsOfFile.get(sourceFile);
    const targetRegions = regionsOfFile.get(targetFile);
    if (sourceRegions === undefined || targetRegions === undefined) {
      continue;
    }
    for (const regionId of sourceRegions) {
      if (targetRegions.includes(regionId)) {
        buckets.get(regionId)?.push({ source: sourceFile, target: targetFile, strength: edge.strength });
      }
    }
  }
  return buckets;
}

/**
 * Reconstruct one Region: run community detection over the Region's File
 * nodes and the strength-weighted edges among them (already bucketed, at file
 * granularity), then emit one group per community in content order.
 */
function reconstructRegion(
  fileIds: readonly NodeId[],
  edges: CommunitySubgraph["edges"],
  seed: number,
  detector: CommunityDetector
): RegionGroup[] {
  const assignment = detector.detect({ nodeIds: [...fileIds], edges }, seed);

  const membersOf = new Map<number, NodeId[]>();
  for (const fileId of [...fileIds].sort(compareIds)) {
    const community = assignment.communityOf.get(fileId) ?? 0;
    const list = membersOf.get(community);
    if (list) {
      list.push(fileId);
    } else {
      membersOf.set(community, [fileId]);
    }
  }

  return [...membersOf.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, members]) => ({ fileIds: members }));
}
