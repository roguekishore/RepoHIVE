import { NextResponse } from "next/server";
import { getRegistryRepo, resolveIndexDir } from "@/lib/repohive/repo-registry";
import { loadIndex, describeError } from "@/lib/repohive/index-loader";
import { adaptRegionDetail } from "@/lib/repohive/region-detail-adapter";

/**
 * `GET /api/graph/{id}/region-detail?region=<regionId>` — one region's
 * recorded decision joined to its file membership, authored vs derived
 * partitions, and intra-region dependency edges. Feeds the boundary-morph and
 * provenance surfaces. Region ids carry a scheme prefix (`pkg:…`), so they
 * travel as a query parameter rather than a path segment.
 */
export async function GET(
  request: Request,
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

  const regionId = new URL(request.url).searchParams.get("region");
  if (!regionId) {
    return NextResponse.json(
      { detail: "Missing required query parameter 'region'.", code: "MISSING_REGION" },
      { status: 400 },
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

  const detail = adaptRegionDetail(result.value.hierarchy, result.value.metadata, regionId);
  if (!detail) {
    return NextResponse.json(
      { detail: `No recorded decision for region '${regionId}'.`, code: "UNKNOWN_REGION" },
      { status: 404 },
    );
  }

  return NextResponse.json(detail);
}
