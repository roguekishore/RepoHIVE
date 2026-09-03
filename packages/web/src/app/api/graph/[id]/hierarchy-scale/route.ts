import { NextResponse } from "next/server";
import { getRegistryRepo, resolveIndexDir } from "@/lib/repohive/repo-registry";
import { loadIndex, describeError } from "@/lib/repohive/index-loader";
import { adaptHierarchyScale } from "@/lib/repohive/hierarchy-scale-adapter";

/**
 * `GET /api/graph/{id}/hierarchy-scale` — the whole containment tree as
 * pre-computed radial arcs, coloured by recorded decision state.
 *
 * The aggregation happens here rather than in the browser: broadleaf is 30,889
 * nodes, and shipping the raw tree to compute sweeps client-side would send
 * megabytes to draw a few thousand arcs.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
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

  return NextResponse.json(
    adaptHierarchyScale(result.value.hierarchy, result.value.metadata),
  );
}
