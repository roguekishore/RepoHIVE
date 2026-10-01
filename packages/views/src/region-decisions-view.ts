/**
 * The per-Region decision record for the Decision Audit view
 * (`GET /api/graph/{id}/region-decisions`, spec R11, Phase D). Read straight
 * from `metadata.json` (never recomputed): cohesion, coupling,
 * structural-quality score, the boundary applied, the chosen action,
 * confidence, and whether the decision was measured or overridden. Each region
 * also carries the ids of the group nodes it maps to so the audit can bring the
 * corresponding cards into view on the map (R11.4).
 *
 * Moved from the route handler without behaviour change.
 */
import type { Hierarchy, Metadata } from "@repohive/core";
import { regionFileMembership, stripRegionScheme } from "./region-detail-adapter.js";
import { buildGroupPackagePrefixes } from "./zoom-labels.js";

export function buildRegionDecisionsView(hierarchy: Hierarchy, metadata: Metadata) {
  // Each decision names the group nodes it produced (Gap 12), so the
  // region->groups cross-link is read from the audit record rather than inferred
  // from package prefixes. Fall back to deriving it only for an index written
  // before the field existed, where the heuristic is all there is.
  const legacyGroupsByPackage = (): Map<string, string[]> => {
    const byPackage = new Map<string, string[]>();
    for (const [groupId, pkg] of buildGroupPackagePrefixes(hierarchy)) {
      if (!pkg) continue;
      const list = byPackage.get(pkg);
      if (list) list.push(groupId);
      else byPackage.set(pkg, [groupId]);
    }
    return byPackage;
  };
  const derived = metadata.regionDecisions.some((d) => d.groupIds === undefined)
    ? legacyGroupsByPackage()
    : null;

  // File membership per region (nearest regioned ancestor, Gap 12): a count,
  // not a computed metric, so surfaces can size marks by region weight.
  const membership = regionFileMembership(hierarchy);

  const regions = [...metadata.regionDecisions]
    .map((d) => {
      const pkg = d.regionId.startsWith("pkg:") ? d.regionId.slice("pkg:".length) : d.regionId;
      const groupIds = d.groupIds ?? derived?.get(pkg) ?? [];
      return {
        regionId: d.regionId,
        displayName: stripRegionScheme(d.regionId),
        cohesion: d.cohesion,
        coupling: d.coupling,
        ...(d.modularity !== undefined ? { modularity: d.modularity } : {}),
        score: d.score,
        action: d.action,
        automaticAction: d.automaticAction,
        userOverridden: d.userOverridden,
        decisionConfidence: d.decisionConfidence,
        fileCount: (membership.get(d.regionId) ?? []).length,
        groupIds: [...groupIds].sort(),
      };
    })
    .sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0));

  return {
    boundary: metadata.structuralQualityBoundary,
    metricWeights: metadata.metricWeights,
    cohesionSquashConstant: metadata.cohesionSquashConstant,
    seed: metadata.configuration?.communityDetectionSeed ?? null,
    regionCount: regions.length,
    regions,
  };
}
