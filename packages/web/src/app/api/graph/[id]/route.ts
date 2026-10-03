import { NextResponse } from "next/server";
import { getRegistryRepo, resolveIndexDir } from "@/lib/repohive/repo-registry";
import { loadIndex, describeError } from "@/lib/repohive/index-loader";
import { buildGraphView } from "@repohive/views";

/**
 * `GET /api/graph/{id}` — the flat baseline (spec R10, Phase D). Every file
 * leaf and every leaf dependency edge as ONE unstructured node-link graph, in
 * the vendored `GraphExportResponse` shape so the `files`-scope graph canvas
 * renders it unchanged. This is RepoHIVE's own dependency graph drawn flat —
 * the deliberate "before" to the hierarchy's "after" (R10.6).
 *
 * The engine's edges are class/function-level, so each edge is lifted to its
 * containing file (matching the zoom map's relations) and de-duplicated. Values
 * the engine does not produce (pagerank, betweenness, doc/test/entry flags) are
 * emitted neutral; community_id is the file's enclosing group, so the canvas's
 * community colouring still groups the tangle.
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

  return NextResponse.json(buildGraphView(result.value.hierarchy));
}
