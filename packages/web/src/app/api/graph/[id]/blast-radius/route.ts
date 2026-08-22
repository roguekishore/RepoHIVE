import { NextResponse } from "next/server";
import { getRegistryRepo, resolveIndexDir } from "@/lib/repohive/repo-registry";
import { loadIndex, describeError } from "@/lib/repohive/index-loader";
import type { Hierarchy } from "@/lib/repohive/index-loader";

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

/** Descendant graph-leaf ids (file/class/function) under `startId`, inclusive. */
function subtreeLeafSeeds(hierarchy: Hierarchy, startId: string): string[] {
  const seeds: string[] = [];
  const stack = [startId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = hierarchy.nodes.get(id);
    if (!node) continue;
    if (node.kind === "file" || node.kind === "class" || node.kind === "function") {
      seeds.push(id);
    }
    for (const childId of node.childIds) stack.push(childId);
  }
  return seeds;
}

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

  // Reverse adjacency (target -> its dependents), built once.
  const dependentsOf = new Map<string, string[]>();
  for (const edge of hierarchy.leafEdges) {
    const list = dependentsOf.get(edge.target);
    if (list) list.push(edge.source);
    else dependentsOf.set(edge.target, [edge.source]);
  }

  // Multi-source reverse BFS from the selected subtree's graph leaves.
  const seeds = subtreeLeafSeeds(hierarchy, nodeId);
  const impacted = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of dependentsOf.get(current) ?? []) {
      if (!impacted.has(dependent)) {
        impacted.add(dependent);
        queue.push(dependent);
      }
    }
  }

  // Roll each impacted graph node up to its map-visible ancestors (the file it
  // lives in and every enclosing group), so a card lights up at any zoom level.
  const highlight = new Set<string>();
  for (const impactedId of impacted) {
    let node = hierarchy.nodes.get(impactedId);
    while (node) {
      if (node.kind === "file" || node.kind === "group") highlight.add(node.id);
      if (node.parentId === null) break;
      node = hierarchy.nodes.get(node.parentId);
    }
  }

  return NextResponse.json({
    node: nodeId,
    count: highlight.size,
    ids: [...highlight].sort(),
  });
}
