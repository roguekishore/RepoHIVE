import { NextResponse } from "next/server";
import { getRegistryRepo, resolveIndexDir } from "@/lib/repohive/repo-registry";
import { loadIndex, describeError } from "@/lib/repohive/index-loader";
import { buildRegionDecisionsView } from "@repohive/views";

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

  return NextResponse.json(buildRegionDecisionsView(result.value.hierarchy, result.value.metadata));
}
