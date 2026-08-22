import { NextResponse } from "next/server";
import { getRegistryRepo, resolveIndexDir } from "@/lib/repohive/repo-registry";
import { loadIndex, describeError } from "@/lib/repohive/index-loader";
import type { Hierarchy } from "@/lib/repohive/index-loader";

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

/** Nearest `file` ancestor of a graph node (folds class/function up). */
function fileAncestor(hierarchy: Hierarchy, id: string): string | null {
  let cur = hierarchy.nodes.get(id);
  while (cur && cur.kind !== "file") {
    cur = cur.parentId ? hierarchy.nodes.get(cur.parentId) : undefined;
  }
  return cur ? cur.id : null;
}

/** The file's immediate enclosing group id, for community colouring. */
function enclosingGroup(hierarchy: Hierarchy, fileId: string): string | null {
  let cur = hierarchy.nodes.get(fileId);
  while (cur && cur.parentId !== null) {
    const parent = hierarchy.nodes.get(cur.parentId);
    if (parent?.kind === "group") return parent.id;
    cur = parent;
  }
  return null;
}

function sourcePath(fileId: string): string {
  return fileId.startsWith("file:") ? fileId.slice("file:".length) : fileId;
}

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

  const { hierarchy } = result.value;

  // Stable integer per enclosing group, for deterministic community colouring.
  const groupIndex = new Map<string, number>();
  const fileNodes = [...hierarchy.nodes.values()].filter((n) => n.kind === "file");

  // Count class/function members per file (symbol_count) in one pass.
  const memberCount = new Map<string, number>();
  for (const node of hierarchy.nodes.values()) {
    if (node.kind === "class" || node.kind === "function") {
      const file = fileAncestor(hierarchy, node.id);
      if (file) memberCount.set(file, (memberCount.get(file) ?? 0) + 1);
    }
  }

  const nodes = fileNodes
    .map((file) => {
      const group = enclosingGroup(hierarchy, file.id);
      let communityId = 0;
      if (group) {
        if (!groupIndex.has(group)) groupIndex.set(group, groupIndex.size);
        communityId = groupIndex.get(group)!;
      }
      const path = sourcePath(file.id);
      return {
        node_id: path,
        node_type: "file",
        language: path.endsWith(".java") ? "java" : "",
        symbol_count: memberCount.get(file.id) ?? 0,
        pagerank: 0,
        betweenness: 0,
        community_id: communityId,
        is_test: false,
        is_entry_point: false,
        has_doc: false,
      };
    })
    .sort((a, b) => (a.node_id < b.node_id ? -1 : a.node_id > b.node_id ? 1 : 0));

  // Lift every leaf edge to its files, drop self-loops, de-duplicate directed
  // pairs. This is the same tangle the hierarchy untangles — drawn flat.
  const linkSet = new Map<string, { source: string; target: string }>();
  for (const edge of hierarchy.leafEdges) {
    const s = fileAncestor(hierarchy, edge.source);
    const t = fileAncestor(hierarchy, edge.target);
    if (!s || !t || s === t) continue;
    const source = sourcePath(s);
    const target = sourcePath(t);
    const key = `${source}\u0000${target}`;
    if (!linkSet.has(key)) linkSet.set(key, { source, target });
  }
  const links = [...linkSet.values()]
    .map((l) => ({ source: l.source, target: l.target, imported_names: [] as string[] }))
    .sort(
      (a, b) =>
        (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) ||
        (a.target < b.target ? -1 : a.target > b.target ? 1 : 0),
    );

  return NextResponse.json({
    nodes,
    links,
    truncated: false,
    total_node_count: nodes.length,
  });
}
