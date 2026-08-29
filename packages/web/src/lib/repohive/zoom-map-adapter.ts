/**
 * Zoom_Map_Adapter (spec R5) — the single pure function that projects a parsed
 * Index_File_Set onto the vendored `ZoomMap` contract. It is the only place
 * that knows both contracts (R5.11).
 *
 * Pure: no fs, network, clock, or RNG (R5.1/R8.2). All ordering is canonical
 * (by id / sibling rank), so the same index yields a byte-identical map (R8).
 *
 * 4-level map (decided, protocol §7-b): the leaf is the `file` node; `class`
 * and `function` nodes are folded away. Node kinds map:
 *   repository -> system · group(L1) -> layer · group(L2) -> group ·
 *   group(L3+) -> folder · file -> file (leaf).
 *
 * It never computes cohesion, coupling, a quality score, a decision, or a
 * community (R5.9); every such value it shows is read from the index.
 */

import type { ZoomMap, ZoomNode, ZoomRelation, ZoomKind } from "@repohive/ui/zoom";
import type { Hierarchy, Metadata, RegionDecision } from "@repohive/core";
import { buildDisplayLabels, buildGroupPackagePrefixes } from "./zoom-labels";

/** Hierarchy node kinds that survive into the map (file is the leaf). */
const EMITTED_KINDS = new Set(["repository", "group", "file"]);

/**
 * Coupling bands (decided, protocol §7-c). A single documented, config-free
 * threshold on a relation's edge count. Tune by eye if a band looks over- or
 * under-populated; keep it here as the one source of truth.
 */
function couplingBand(edgeCount: number): string {
  if (edgeCount >= 13) return "tight";
  if (edgeCount >= 4) return "moderate";
  return "loose";
}

/** Map a hierarchy node's kind + level to a ZoomKind (R5.3). */
function zoomKindOf(kind: string, level: number): ZoomKind {
  if (kind === "repository") return "system";
  if (kind === "file") return "file";
  // group
  if (level === 1) return "layer";
  if (level === 2) return "group";
  return "folder";
}

/** Source path carried on a file leaf (its `file:<path>` id, prefix stripped). */
function fileSourcePath(id: string): string {
  return id.startsWith("file:") ? id.slice("file:".length) : id;
}

/**
 * Decision_Encoding (spec R7), carried on the `summary` channel so the
 * unmodified canvas (large cards) and detail panel both surface it, and it
 * stays perceivable without colour (R7.6). Read straight from the recorded
 * per-Region decision — never recomputed (R7.2/R5.9). Score and confidence are
 * shown to two places for a glance; the exact values live in the (deferred)
 * Decision Audit view.
 */
function decisionSummary(decision: RegionDecision): string {
  const verb = decision.action === "preserve" ? "Preserved" : "Reconstructed";
  const gloss =
    decision.action === "preserve"
      ? "package kept as authored"
      : "regrouped by dependency clustering";
  const quality = decision.score.toFixed(2);
  const confidence = decision.decisionConfidence.toFixed(2);
  const overridden = decision.userOverridden ? " \u00b7 overridden by config" : "";
  return `${verb} \u00b7 ${gloss} \u00b7 quality ${quality} \u00b7 confidence ${confidence}${overridden}`;
}

export function adaptIndexToZoomMap(
  hierarchy: Hierarchy,
  metadata: Metadata,
  rootName: string,
): ZoomMap {
  const { nodes, leafAttributes, leafEdges, crossGroupEdges } = hierarchy;
  const rootId = hierarchy.repositoryId;

  // --- 1. Emitted node set + emitted child lists (canonical order kept) -----
  const emitted = [...nodes.values()].filter((n) => EMITTED_KINDS.has(n.kind));
  const emittedIds = new Set(emitted.map((n) => n.id));
  const emittedChildren = new Map<string, string[]>();
  const siblingRank = new Map<string, number>();
  for (const node of emitted) {
    const kids = node.childIds.filter((id) => emittedIds.has(id));
    emittedChildren.set(node.id, kids);
    kids.forEach((id, index) => siblingRank.set(id, index));
  }
  siblingRank.set(rootId, 0);

  // --- 2. Roll-up counts (bottom-up: children are deeper than parents) ------
  const fileLeafCount = new Map<string, number>();
  const descendantCount = new Map<string, number>();
  for (const node of [...emitted].sort((a, b) => b.level - a.level)) {
    const kids = emittedChildren.get(node.id) ?? [];
    if (node.kind === "file") {
      fileLeafCount.set(node.id, 1);
      descendantCount.set(node.id, 0);
      continue;
    }
    let files = 0;
    let descendants = 0;
    for (const childId of kids) {
      files += fileLeafCount.get(childId) ?? 0;
      descendants += 1 + (descendantCount.get(childId) ?? 0);
    }
    fileLeafCount.set(node.id, files);
    descendantCount.set(node.id, descendants);
  }

  // --- 3. Labels (single module, R6) ---------------------------------------
  const labels = buildDisplayLabels(hierarchy, rootName);

  // --- 3b. Decision encoding: join each group to its Region decision (R7) ---
  // Exact join: the engine records each group's originating Region on the node
  // itself (Gap 12), so the group→decision link is read, not inferred. This
  // replaced a package-prefix heuristic that was exact only for a preserved
  // package and approximate for reconstructed sub-clusters — which is precisely
  // where the adaptive contribution is most worth seeing. A group that carries
  // no `regionId` is a Repository-fan-out wrapper belonging to no region, and
  // correctly shows no decision.
  const decisionByRegion = new Map<string, RegionDecision>();
  for (const decision of metadata.regionDecisions) {
    decisionByRegion.set(decision.regionId, decision);
  }
  const groupSummary = new Map<string, string>();
  const groupDecision = new Map<string, "preserve" | "reconstruct">();
  for (const node of hierarchy.nodes.values()) {
    if (node.kind !== "group" || node.regionId === undefined) continue;
    const decision = decisionByRegion.get(node.regionId);
    if (decision) {
      groupSummary.set(node.id, decisionSummary(decision));
      groupDecision.set(node.id, decision.action);
    }
  }

  // The package prefix remains the group's *subtitle* (its `path`), which is a
  // display concern and legitimately derived from members.
  const groupPackages = buildGroupPackagePrefixes(hierarchy);

  // --- 4. Nodes -------------------------------------------------------------
  const zoomNodes: ZoomNode[] = emitted.map((node) => {
    const kind = zoomKindOf(node.kind, node.level);
    const isFile = node.kind === "file";
    const isGroup = node.kind === "group";
    // E2: files carry their source path; groups carry the full package prefix
    // (the hover card shows it as the subtitle under the short label).
    const path = isFile
      ? fileSourcePath(node.id)
      : isGroup
        ? (groupPackages.get(node.id) ?? "")
        : "";
    return {
      id: node.id,
      parent_id: node.parentId,
      level: node.level,
      kind,
      name: labels.get(node.id) ?? node.id,
      path,
      children: emittedChildren.get(node.id) ?? [],
      importance: fileLeafCount.get(node.id) ?? 0,
      sibling_rank: siblingRank.get(node.id) ?? 0,
      metrics: {
        file_count: fileLeafCount.get(node.id) ?? 0,
        descendant_count: descendantCount.get(node.id) ?? 0,
        // No engine data for these — emit neutral zeros (R5.10).
        hotspot_count: 0,
        dead_count: 0,
        entry_point_count: 0,
        on_flow_count: 0,
      },
      layout: null, // canvas computes deterministic placement (R8.3)
      summary: groupSummary.get(node.id) ?? "",
      language: isFile && path.endsWith(".java") ? "java" : null,
      health_score: null,
      is_entry_point: false,
      is_hotspot: false,
      is_dead: false,
      is_test: false,
      on_flow: false,
      // E3: structured decision drives the card badge/tint + legend.
      decision: groupDecision.get(node.id) ?? null,
    };
  });
  zoomNodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // --- 5. Relations: only between siblings (R5.6/R5.7) ----------------------
  const parentOf = (id: string): string | null => nodes.get(id)?.parentId ?? null;

  /** Nearest `file` ancestor of a leaf-edge endpoint (folds class/function). */
  const fileAncestor = (id: string): string | null => {
    let cur = nodes.get(id);
    while (cur && cur.kind !== "file") {
      cur = cur.parentId ? nodes.get(cur.parentId) : undefined;
    }
    return cur ? cur.id : null;
  };

  // Accumulate one weight per directed sibling pair, keyed by parent+src+tgt.
  const relationWeight = new Map<string, { parent: string; source: string; target: string; weight: number }>();
  const accumulate = (parent: string, source: string, target: string, weight: number): void => {
    const key = `${parent}\u0000${source}\u0000${target}`;
    const existing = relationWeight.get(key);
    if (existing) existing.weight += weight;
    else relationWeight.set(key, { parent, source, target, weight });
  };

  // Group<->group aggregated edges: keep only same-parent (sibling) pairs.
  for (const edge of crossGroupEdges) {
    if (!emittedIds.has(edge.source) || !emittedIds.has(edge.target)) continue;
    const p = parentOf(edge.source);
    if (p === null || p !== parentOf(edge.target)) continue;
    accumulate(p, edge.source, edge.target, edge.weight);
  }

  // Leaf edges lifted to their containing files: keep only same-parent files.
  for (const edge of leafEdges) {
    const source = fileAncestor(edge.source);
    const target = fileAncestor(edge.target);
    if (!source || !target || source === target) continue;
    const p = parentOf(source);
    if (p === null || p !== parentOf(target)) continue;
    accumulate(p, source, target, 1);
  }

  const relations: ZoomRelation[] = [...relationWeight.values()].map((r) => {
    const edgeCount = Math.max(1, Math.round(r.weight));
    return {
      parent_id: r.parent,
      source_id: r.source,
      target_id: r.target,
      label: "depends on",
      edge_count: edgeCount,
      coupling: couplingBand(edgeCount),
    };
  });
  relations.sort(
    (a, b) =>
      (a.parent_id < b.parent_id ? -1 : a.parent_id > b.parent_id ? 1 : 0) ||
      (a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0) ||
      (a.target_id < b.target_id ? -1 : a.target_id > b.target_id ? 1 : 0),
  );

  // --- 6. Envelope ----------------------------------------------------------
  const maxDepth = emitted.reduce((m, n) => Math.max(m, n.level), 0);
  return {
    root_id: rootId,
    project_name: rootName,
    total_files: fileLeafCount.get(rootId) ?? 0,
    max_depth: maxDepth,
    truncated: false,
    nodes: zoomNodes,
    relations,
  };
}
