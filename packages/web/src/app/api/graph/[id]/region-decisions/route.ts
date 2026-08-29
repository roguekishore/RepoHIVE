import { NextResponse } from "next/server";
import { getRegistryRepo, resolveIndexDir } from "@/lib/repohive/repo-registry";
import { loadIndex, describeError } from "@/lib/repohive/index-loader";
import { buildGroupPackagePrefixes } from "@/lib/repohive/zoom-labels";

/**
 * `GET /api/graph/{id}/region-decisions` — the per-Region decision record for
 * the Decision Audit view (spec R11, Phase D). Read straight from
 * `metadata.json` (never recomputed): cohesion, coupling, structural-quality
 * score, the boundary applied, the chosen action, confidence, and whether the
 * decision was measured or overridden. Each region also carries the ids of the
 * group nodes it maps to (package-prefix join, §7-a) so the audit can bring the
 * corresponding cards into view on the map (R11.4).
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const entry = getRegistryRepo(id);
  if (!entry) {
    return NextResponse.json(
      { detail: `Unknown repository '${id}'.`, code: "UNKNOWN_REPO" },
      { status: 404 },
    );
  }

  const result = loadIndex(resolveIndexDir(entry));
  if (!result.ok) {
    const status = result.error.code === "MISSING_FILES" ? 404 : 500;
    return NextResponse.json(
      { detail: describeError(result.error), code: result.error.code },
      { status },
    );
  }

  const { hierarchy, metadata } = result.value;

  // Each decision names the group nodes it produced (Gap 12), so the
  // region→groups cross-link is read from the audit record rather than inferred
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

  const regions = [...metadata.regionDecisions]
    .map((d) => {
      const pkg = d.regionId.startsWith("pkg:") ? d.regionId.slice("pkg:".length) : d.regionId;
      const groupIds = d.groupIds ?? derived?.get(pkg) ?? [];
      return {
        regionId: d.regionId,
        cohesion: d.cohesion,
        coupling: d.coupling,
        ...(d.modularity !== undefined ? { modularity: d.modularity } : {}),
        score: d.score,
        action: d.action,
        automaticAction: d.automaticAction,
        userOverridden: d.userOverridden,
        decisionConfidence: d.decisionConfidence,
        groupIds: [...groupIds].sort(),
      };
    })
    .sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0));

  return NextResponse.json({
    boundary: metadata.structuralQualityBoundary,
    metricWeights: metadata.metricWeights,
    cohesionSquashConstant: metadata.cohesionSquashConstant,
    regionCount: regions.length,
    regions,
  });
}
