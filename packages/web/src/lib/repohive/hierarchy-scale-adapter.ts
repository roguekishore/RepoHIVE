/**
 * Hierarchy-at-scale adapter — the whole containment tree as a radial icicle,
 * coloured by decision state.
 *
 * The point of the surface is legibility at scale: broadleaf is 30,889 nodes
 * over depth 6, and a reader should be able to see that handled in one image.
 * So the adapter does the aggregation the browser must not: it walks the
 * recorded tree once, rolls file counts up, converts each subtree into an
 * angular sweep proportional to its file count, and drops arcs that would be
 * sub-pixel — reporting how many it dropped rather than hiding them.
 *
 * Pure: no fs, network, clock or RNG. Sibling order is canonical (the engine's
 * own ascending `childIds`), so the same index always yields the same picture —
 * which is what makes it usable as a paper figure.
 *
 * Every arc's colour comes from a recorded region decision joined through
 * `regionId` (Gap 12), inherited down the tree: a file inside a reconstructed
 * group belongs to that region's decision. Only the repository-fan-out wrapper
 * groups belong to no region at all, and they are marked as such rather than
 * being coloured as an outcome.
 */

import type { Hierarchy, HierarchyNode, Metadata } from "@repohive/core";
import { stripRegionScheme } from "./region-detail-adapter";

/** The three recorded outcomes, plus the honest absence. */
export type ArcState = "preserve" | "reconstruct" | "degenerate" | "none";

export interface HierarchyArc {
  id: string;
  /** Depth ring: 0 is the repository at the centre. */
  level: number;
  /** Start angle in turns [0,1), measured clockwise from twelve o'clock. */
  start: number;
  /** Angular width in turns. */
  span: number;
  /** File leaves under this node — the quantity the sweep encodes. */
  files: number;
  state: ArcState;
  /** Display label; empty when the arc is too small to ever carry one. */
  label: string;
  /** Region this arc belongs to — its own, or its nearest ancestor's. */
  regionId: string | null;
  /**
   * True only for a group that belongs to no region at all: the fan-out
   * wrappers the engine creates to bound branching. Those genuinely carry no
   * decision; everything else inherits one.
   */
  wrapper: boolean;
}

export interface HierarchyScale {
  arcs: HierarchyArc[];
  maxLevel: number;
  totalFiles: number;
  /** Level bands straight from `perLevel[]`, for the ring key. */
  levels: Array<{
    level: number;
    groupNodeCount: number;
    leafNodeCount: number;
    crossGroupEdgeCount: number;
    leafEdgeCount: number;
  }>;
  /** Arcs omitted because their sweep was below the visibility floor. */
  omittedArcs: number;
  /** Every node in the recorded tree, so the caption can state the real size. */
  totalNodes: number;
  counts: Record<ArcState, number>;
}

/**
 * Arcs thinner than this (in turns) are dropped: below roughly a third of a
 * degree an arc cannot be seen or hit-tested, so drawing it costs work and
 * communicates nothing. Stated in the UI.
 */
const MIN_SPAN = 0.0009;

export function adaptHierarchyScale(hierarchy: Hierarchy, metadata: Metadata): HierarchyScale {
  const { nodes } = hierarchy;

  // --- Decision state per region, from the recorded decisions.
  const stateOfRegion = new Map<string, ArcState>();
  for (const decision of metadata.regionDecisions) {
    const degenerate = decision.score === 0 && decision.cohesion === 0;
    stateOfRegion.set(decision.regionId, degenerate ? "degenerate" : decision.action);
  }

  // --- File-leaf roll-up, bottom-up (children are always deeper than parents).
  const files = new Map<string, number>();
  const ordered = [...nodes.values()].sort((a, b) => b.level - a.level);
  for (const node of ordered) {
    if (node.kind === "file") {
      files.set(node.id, 1);
      continue;
    }
    let sum = 0;
    for (const childId of node.childIds) sum += files.get(childId) ?? 0;
    files.set(node.id, sum);
  }

  // --- Walk down from the root, allocating each node's sweep among children in
  // proportion to their file counts. Iterative, so depth cannot blow the stack.
  const arcs: HierarchyArc[] = [];
  const counts: Record<ArcState, number> = {
    preserve: 0,
    reconstruct: 0,
    degenerate: 0,
    none: 0,
  };
  let omittedArcs = 0;
  let maxLevel = 0;

  const labelOf = (node: HierarchyNode, span: number): string => {
    // Only arcs with room get a label; the rest rely on the hover title.
    if (span < 0.02) return "";
    if (node.kind === "repository") return "";
    if (node.regionId) return stripRegionScheme(node.regionId).split(".").pop() ?? "";
    return "";
  };

  const root = nodes.get(hierarchy.repositoryId);
  if (!root) {
    return {
      arcs,
      maxLevel: 0,
      totalFiles: 0,
      levels: [],
      omittedArcs: 0,
      totalNodes: nodes.size,
      counts,
    };
  }

  const totalFiles = files.get(root.id) ?? 0;
  // A node's region is the one recorded on it or, failing that, on its nearest
  // ancestor that carries one: a file inside a reconstructed group belongs to
  // that region's decision, and painting it as "no decision" would hide a
  // recorded fact. `null` is reserved for genuine structural wrappers — the
  // fan-out groups the engine creates, which correspond to no region by design.
  const stack: Array<{
    node: HierarchyNode;
    start: number;
    span: number;
    inheritedRegion: string | null;
  }> = [{ node: root, start: 0, span: 1, inheritedRegion: null }];

  while (stack.length > 0) {
    const { node, start, span, inheritedRegion } = stack.pop()!;
    if (node.level > maxLevel) maxLevel = node.level;
    const region = node.regionId ?? inheritedRegion;

    // The repository itself is the hub, drawn by the view rather than as an arc.
    if (node.kind !== "repository") {
      const state: ArcState = region ? (stateOfRegion.get(region) ?? "none") : "none";
      counts[state] += 1;
      arcs.push({
        id: node.id,
        level: node.level,
        start,
        span,
        files: files.get(node.id) ?? 0,
        state,
        label: labelOf(node, span),
        regionId: region,
        // Only a group that carries no region of its own AND inherits none is a
        // structural wrapper; a file never is.
        wrapper: node.kind === "group" && region === null,
      });
    }

    // Files are the leaves of this picture: their own children (classes,
    // functions) are not containment the reader needs at this altitude.
    if (node.kind === "file") continue;

    const children = node.childIds
      .map((id) => nodes.get(id))
      .filter((child): child is HierarchyNode => child !== undefined);
    const childFileTotal = children.reduce((sum, child) => sum + (files.get(child.id) ?? 0), 0);
    if (childFileTotal <= 0) continue;

    // Push in reverse so the LIFO stack pops them in canonical order, which is
    // what makes the picture reproducible.
    let cursor = start;
    const allocated: Array<{
      node: HierarchyNode;
      start: number;
      span: number;
      inheritedRegion: string | null;
    }> = [];
    for (const child of children) {
      const childSpan = (span * (files.get(child.id) ?? 0)) / childFileTotal;
      if (childSpan < MIN_SPAN) {
        omittedArcs += 1;
        cursor += childSpan;
        continue;
      }
      allocated.push({ node: child, start: cursor, span: childSpan, inheritedRegion: region });
      cursor += childSpan;
    }
    for (let i = allocated.length - 1; i >= 0; i--) stack.push(allocated[i]!);
  }

  // Canonical output order: outer rings drawn after inner ones, ties on id.
  arcs.sort(
    (a, b) => a.level - b.level || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  return {
    arcs,
    maxLevel,
    totalFiles,
    levels: metadata.perLevel.map((row) => ({
      level: row.level,
      groupNodeCount: row.groupNodeCount,
      leafNodeCount: row.leafNodeCount,
      crossGroupEdgeCount: row.crossGroupEdgeCount,
      leafEdgeCount: row.leafEdgeCount,
    })),
    omittedArcs,
    totalNodes: nodes.size,
    counts,
  };
}
