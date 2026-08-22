import { NextResponse } from "next/server";
import { getRegistryRepo, resolveIndexDir } from "@/lib/repohive/repo-registry";
import { loadIndex, describeError } from "@/lib/repohive/index-loader";
import { adaptIndexToZoomMap } from "@/lib/repohive/zoom-map-adapter";

/**
 * `GET /api/graph/{id}/zoom-map` — the single endpoint that feeds the
 * semantic-zoom canvas.
 *
 * Index_Loader (read `fixtures/<repo>/index`) -> Zoom_Map_Adapter -> ZoomMap.
 * The endpoint and the ZoomMap contract are fixed; a future backend (hosted
 * API / MCP / cloud DB) is a change to the loader internals only.
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
    // Surface the parser's own reason and the file involved (R4.3/R4.4).
    // A missing/incomplete index is a 404; a malformed one is a 500.
    const status = result.error.code === "MISSING_FILES" ? 404 : 500;
    return NextResponse.json(
      { detail: describeError(result.error), code: result.error.code },
      { status },
    );
  }

  const zoomMap = adaptIndexToZoomMap(
    result.value.hierarchy,
    result.value.metadata,
    entry.name,
  );
  return NextResponse.json(zoomMap);
}
