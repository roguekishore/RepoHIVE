/**
 * Architecture adapter — the three recorded artifacts that describe the built
 * hierarchy rather than the decisions behind it:
 *
 *   1. Per-level flow.  `perLevel[]` verbatim: how many group nodes, leaves and
 *      edges each level carries. Chart-ready as recorded.
 *   2. DSM over groups.  `crossGroupEdges` as a square matrix, ordered so the
 *      recorded regions form blocks on the diagonal.
 *   3. Determinism.  Group ids are content-addressed (`g_<sha1>` over canonical
 *      membership), so the same membership always yields the same id. The panel
 *      shows the evidence rather than asserting the property.
 *
 * Pure: no fs, network, clock or RNG. Every ordering is canonical with an id
 * tie-break, so the same index produces the same matrix and the same picture.
 *
 * Nothing here derives a metric the engine did not record. In particular the
 * DSM deliberately does not compute dependency cycles or rule violations: the
 * vendored `DsmMatrixView` renders both, and feeding it `false` everywhere
 * would imply we had checked. What we have is the recorded aggregated edge
 * weight between two groups, which is what this matrix shows.
 */

import type { Hierarchy, Metadata } from "@repohive/core";
import { stripRegionScheme } from "./region-detail-adapter";

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export type GroupState = "preserve" | "reconstruct" | "degenerate" | "none";

export interface DsmGroup {
  id: string;
  /** Short display label; the full id and region are carried alongside. */
  label: string;
  regionId: string | null;
  state: GroupState;
  level: number;
  files: number;
  /** Recorded weight leaving this group. */
  outWeight: number;
  /** Recorded weight arriving at this group. */
  inWeight: number;
}

export interface DsmEntry {
  /** Row index (depends on). */
  from: number;
  /** Column index (depended upon). */
  to: number;
  /** Recorded aggregated edge weight. */
  weight: number;
}

export interface GroupDsm {
  groups: DsmGroup[];
  entries: DsmEntry[];
  /** Region blocks in axis order, for the diagonal banding. */
  blocks: Array<{ regionId: string; label: string; start: number; size: number; state: GroupState }>;
  maxWeight: number;
  /** Groups present at the chosen level in the index. */
  totalGroups: number;
  /** Groups omitted by the render budget (0 when none). */
  omittedGroups: number;
  /** Edges between groups that both survived the budget. */
  shownEdges: number;
  /** Every recorded cross-group edge at this level. */
  totalEdges: number;
  level: number;
}

export interface LevelFlowRow {
  level: number;
  groupNodeCount: number;
  leafNodeCount: number;
  crossGroupEdgeCount: number;
  leafEdgeCount: number;
}

export interface DeterminismEvidence {
  /** `g_<sha1>` / `r_<sha1>`: the scheme, stated once. */
  scheme: string;
  repositoryId: string;
  /** A few real group ids with their membership size, as worked examples. */
  samples: Array<{
    id: string;
    regionId: string | null;
    memberCount: number;
    /** The first few member ids, canonically ordered — the hash's input. */
    members: string[];
  }>;
  totalGroups: number;
  /** Recorded run configuration: what a re-run would need to reproduce. */
  configuration: Metadata["configuration"] | null;
  seed: number | null;
  /** Distinct group ids vs total groups — a collision would show here. */
  distinctIds: number;
}

/** Groups are dense at deeper levels; the matrix caps for legibility. */
export const DSM_BUDGET = 48;

/**
 * The level whose group-to-group structure is worth showing.
 *
 * Preference order, and the reason for it: a level whose groups carry recorded
 * regions, because the block structure this matrix exists to reveal is regional
 * — on a multi-module repository the shallow levels are entirely fan-out
 * wrappers, which belong to no region and would produce a matrix with no blocks
 * at all. Among levels that do carry regions, the deepest that still fits the
 * budget; failing that the shallowest regioned level, whose group count the
 * render budget then trims (and reports).
 */
export function chooseDsmLevel(hierarchy: Hierarchy, metadata: Metadata): number {
  const regionedPerLevel = new Map<number, number>();
  const groupsPerLevel = new Map<number, number>();
  for (const node of hierarchy.nodes.values()) {
    if (node.kind !== "group") continue;
    groupsPerLevel.set(node.level, (groupsPerLevel.get(node.level) ?? 0) + 1);
    if (node.regionId !== undefined) {
      regionedPerLevel.set(node.level, (regionedPerLevel.get(node.level) ?? 0) + 1);
    }
  }

  const regioned = [...regionedPerLevel.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => a[0] - b[0]);
  if (regioned.length > 0) {
    const withinBudget = regioned.filter(([, count]) => count <= DSM_BUDGET);
    // Deepest either way. Depth is where a region has split into several
    // groups, which is exactly where the diagonal blocks come from; at the
    // shallow levels each region contributes a single group and every block
    // degenerates to one cell. When the deepest level overflows the budget the
    // region-whole admission below trims it and reports what it dropped.
    const preferred = withinBudget.length > 0 ? withinBudget : regioned;
    return preferred[preferred.length - 1]![0];
  }

  // No level carries regions (an index predating group provenance): fall back
  // to the recorded per-level counts.
  const withGroups = metadata.perLevel.filter((row) => row.groupNodeCount > 1);
  if (withGroups.length === 0) return 1;
  const withinBudget = withGroups.filter((row) => row.groupNodeCount <= DSM_BUDGET);
  const chosen = withinBudget.length > 0 ? withinBudget[withinBudget.length - 1] : withGroups[0];
  return chosen!.level;
}

export function adaptGroupDsm(
  hierarchy: Hierarchy,
  metadata: Metadata,
  level?: number,
  budget: number = DSM_BUDGET,
): GroupDsm {
  const chosenLevel = level ?? chooseDsmLevel(hierarchy, metadata);

  const stateOfRegion = new Map<string, GroupState>();
  for (const decision of metadata.regionDecisions) {
    const degenerate = decision.score === 0 && decision.cohesion === 0;
    stateOfRegion.set(decision.regionId, degenerate ? "degenerate" : decision.action);
  }

  // File roll-up, bottom-up.
  const files = new Map<string, number>();
  for (const node of [...hierarchy.nodes.values()].sort((a, b) => b.level - a.level)) {
    if (node.kind === "file") {
      files.set(node.id, 1);
      continue;
    }
    let sum = 0;
    for (const childId of node.childIds) sum += files.get(childId) ?? 0;
    files.set(node.id, sum);
  }

  const atLevel = [...hierarchy.nodes.values()]
    .filter((node) => node.kind === "group" && node.level === chosenLevel)
    .sort((a, b) => byId(a.id, b.id));
  const idsAtLevel = new Set(atLevel.map((n) => n.id));

  // Recorded edges at this level, aggregated per ordered pair.
  const edgesAtLevel = hierarchy.crossGroupEdges.filter(
    (edge) => idsAtLevel.has(edge.source) && idsAtLevel.has(edge.target),
  );
  const outWeight = new Map<string, number>();
  const inWeight = new Map<string, number>();
  for (const edge of edgesAtLevel) {
    outWeight.set(edge.source, (outWeight.get(edge.source) ?? 0) + edge.weight);
    inWeight.set(edge.target, (inWeight.get(edge.target) ?? 0) + edge.weight);
  }

  // --- Render budget: admit whole regions, most-connected region first, until
  // the budget fills. Taking the top-N groups globally would slice regions
  // apart and destroy the very block structure the matrix exists to show, so
  // the unit of admission is the region. Deterministic throughout: regions are
  // ranked by recorded incident weight and tie-broken on regionId, groups
  // within a region by ordinal then id.
  let kept = atLevel;
  if (atLevel.length > budget) {
    const weightOf = (id: string) => (outWeight.get(id) ?? 0) + (inWeight.get(id) ?? 0);
    const byRegion = new Map<string, typeof atLevel>();
    for (const node of atLevel) {
      const key = node.regionId ?? `\u0000group:${node.id}`;
      const list = byRegion.get(key);
      if (list) list.push(node);
      else byRegion.set(key, [node]);
    }
    const ranked = [...byRegion.entries()]
      .map(([key, members]) => ({
        key,
        members,
        weight: members.reduce((sum, node) => sum + weightOf(node.id), 0),
      }))
      .sort((a, b) => b.weight - a.weight || byId(a.key, b.key));

    const admitted: typeof atLevel = [];
    for (const region of ranked) {
      if (admitted.length + region.members.length > budget) continue;
      admitted.push(...region.members);
    }
    // A single region larger than the whole budget would admit nothing; fall
    // back to the most-connected groups so the matrix is never empty.
    kept =
      admitted.length > 0
        ? admitted
        : [...atLevel]
            .sort((a, b) => weightOf(b.id) - weightOf(a.id) || byId(a.id, b.id))
            .slice(0, budget);
  }

  // --- Axis order: by recorded region, then by the engine's own ordinal.
  // This is the reordering that reveals block structure, and it is *read* from
  // the index rather than computed by a clustering pass — intra-region density
  // then shows as a block on the diagonal, and everything off-block is the
  // coupling the engine could not localise.
  const axis = [...kept].sort(
    (a, b) =>
      byId(a.regionId ?? "￿", b.regionId ?? "￿") ||
      (a.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.ordinal ?? Number.MAX_SAFE_INTEGER) ||
      byId(a.id, b.id),
  );
  const indexOf = new Map(axis.map((node, i) => [node.id, i]));

  const groups: DsmGroup[] = axis.map((node) => ({
    id: node.id,
    label: node.regionId
      ? (stripRegionScheme(node.regionId).split(".").pop() ?? node.id.slice(0, 8))
      : node.id.slice(0, 8),
    regionId: node.regionId ?? null,
    state: node.regionId ? (stateOfRegion.get(node.regionId) ?? "none") : "none",
    level: node.level,
    files: files.get(node.id) ?? 0,
    outWeight: outWeight.get(node.id) ?? 0,
    inWeight: inWeight.get(node.id) ?? 0,
  }));

  const entries: DsmEntry[] = [];
  let maxWeight = 0;
  for (const edge of edgesAtLevel) {
    const from = indexOf.get(edge.source);
    const to = indexOf.get(edge.target);
    if (from === undefined || to === undefined) continue;
    entries.push({ from, to, weight: edge.weight });
    if (edge.weight > maxWeight) maxWeight = edge.weight;
  }
  entries.sort((a, b) => a.from - b.from || a.to - b.to);

  // Contiguous region runs along the axis become the diagonal blocks.
  const blocks: GroupDsm["blocks"] = [];
  for (let i = 0; i < groups.length; i++) {
    const regionId = groups[i]!.regionId;
    if (!regionId) continue;
    const last = blocks[blocks.length - 1];
    if (last && last.regionId === regionId && last.start + last.size === i) {
      last.size += 1;
    } else {
      blocks.push({
        regionId,
        label: stripRegionScheme(regionId),
        start: i,
        size: 1,
        state: groups[i]!.state,
      });
    }
  }

  return {
    groups,
    entries,
    blocks,
    maxWeight,
    totalGroups: atLevel.length,
    omittedGroups: atLevel.length - axis.length,
    shownEdges: entries.length,
    totalEdges: edgesAtLevel.length,
    level: chosenLevel,
  };
}

export function adaptLevelFlow(metadata: Metadata): LevelFlowRow[] {
  return metadata.perLevel
    .map((row) => ({
      level: row.level,
      groupNodeCount: row.groupNodeCount,
      leafNodeCount: row.leafNodeCount,
      crossGroupEdgeCount: row.crossGroupEdgeCount,
      leafEdgeCount: row.leafEdgeCount,
    }))
    .sort((a, b) => a.level - b.level);
}

export function adaptDeterminism(
  hierarchy: Hierarchy,
  metadata: Metadata,
  sampleCount = 3,
): DeterminismEvidence {
  const groups = [...hierarchy.nodes.values()]
    .filter((node) => node.kind === "group")
    .sort((a, b) => byId(a.id, b.id));

  // Samples: prefer groups with several members, since a one-member group makes
  // a less interesting worked example. Deterministic — sorted, then sliced.
  const samples = [...groups]
    .sort((a, b) => b.childIds.length - a.childIds.length || byId(a.id, b.id))
    .slice(0, sampleCount)
    .map((node) => ({
      id: node.id,
      regionId: node.regionId ?? null,
      memberCount: node.childIds.length,
      // Already canonical: the engine sorts childIds ascending, and that sorted
      // list is exactly what the id hashes over.
      members: node.childIds.slice(0, 4),
    }));

  return {
    scheme: "g_<sha1( json(sorted member ids) )>",
    repositoryId: hierarchy.repositoryId,
    samples,
    totalGroups: groups.length,
    configuration: metadata.configuration ?? null,
    seed: metadata.configuration?.communityDetectionSeed ?? null,
    distinctIds: new Set(groups.map((g) => g.id)).size,
  };
}
