import { NextResponse } from "next/server";
import { getRegistryRepo, resolveIndexDir } from "@/lib/repohive/repo-registry";
import { loadIndex, describeError } from "@/lib/repohive/index-loader";
import { computeBlastRadius } from "@repohive/views";

/**
 * `GET /api/graph/{id}/blast-radius?node=<id>` — the impacted set for the E6
 * highlight: every node whose dependency path reaches the selected node's
 * subtree, rolled up to the map-visible ancestor cards (files + groups) so a
 * containing card lights up at any zoom level.
 *
 * This mirrors `@repohive/core`'s `analyzeBlastRadius` reverse-reachability
 * (dependent -> dependency over `leafEdges`) with NO engine change. It is
 * generalised to a *set* of seeds because the map's leaf is the `file` node
 * while the engine's edges are class/function-level: selecting a file (or a
 * group) seeds from that subtree's graph leaves, so the reach is meaningful
 * rather than empty. Blast radius is static reachability and may under-count
 * dynamic dependencies (reflection, DI) — an honest, documented caveat.
 */

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const nodeId = new URL(request.url).searchParams.get("node");

  const entry = getRegistryRepo(id);
  if (!entry) {
    return NextResponse.json(
      { detail: `Unknown repository '${id}'.`, code: "UNKNOWN_REPO" },
      { status: 404 },
    );
  }
  if (!nodeId) {
    return NextResponse.json(
      { detail: "Missing required query parameter 'node'.", code: "MISSING_NODE" },
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

  const { hierarchy } = result.value;
  if (!hierarchy.nodes.has(nodeId)) {
    return NextResponse.json(
      { detail: `Unknown node '${nodeId}'.`, code: "NODE_NOT_FOUND" },
      { status: 404 },
    );
  }

  return NextResponse.json(computeBlastRadius(hierarchy, nodeId));
}
