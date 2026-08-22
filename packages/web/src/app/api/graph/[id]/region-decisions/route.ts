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

  // package prefix -> group ids, to cross-link each region to its group cards.
  const groupsByPackage = new Map<string, string[]>();
  for (const [groupId, pkg] of buildGroupPackagePrefixes(hierarchy)) {
    if (!pkg) continue;
    const list = groupsByPackage.get(pkg);
    if (list) list.push(groupId);
    else groupsByPackage.set(pkg, [groupId]);
  }

  const regions = [...metadata.regionDecisions]
    .map((d) => {
      const pkg = d.regionId.startsWith("pkg:") ? d.regionId.slice("pkg:".length) : d.regionId;
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
        groupIds: (groupsByPackage.get(pkg) ?? []).slice().sort(),
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
