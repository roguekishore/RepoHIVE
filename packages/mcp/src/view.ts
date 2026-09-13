/**
 * IndexView - the read-only projection the tool handlers work over.
 *
 * `buildIndexView` runs once per index load and precomputes the joins and
 * count roll-ups every tool needs. Everything here READS engine output. The
 * only derived values are:
 *
 * - count roll-ups (descendant file counts, kind counts, per-region member
 *   counts) - counts of engine-recorded data, never metrics;
 * - display aids (`name`, package prefixes, region display names), following
 *   the viewer's Zoom_Map_Adapter convention that labels are a presentation
 *   concern legitimately derived from members;
 * - the documented `assessed` flag (see {@link isAssessed}).
 *
 * Nothing here computes or re-derives a score, decision, confidence or
 * community. Joins between groups and decisions go exclusively through the
 * engine-recorded `regionId` / `ordinal` / `groupIds` fields (Gap 12), never
 * through path or package-prefix heuristics.
 */

import type { DependencyEdge, NodeId, NodeKind } from "@repohive/shared";
import { compareIds } from "@repohive/core";
import type {
  CrossGroupEdge,
  Hierarchy,
  HierarchyNode,
  Metadata,
  RegionDecision,
} from "@repohive/core";

/** A leaf edge as parsed back from the index (strength always present). */
export type LeafEdge = DependencyEdge & { strength: number };

/**
 * The recorded unassessed-region rule (STATE 2026-08-29, measurements
 * register): regions with `score === 0 && cohesion === 0` were never assessed
 * - their score is assigned by the degenerate rule, not measured - yet they
 * carry `decisionConfidence` equal to the full boundary distance (0.5 with the
 * default boundary, the dataset maximum). The engine emits no explicit flag,
 * so this labelled derivation is the honest way to expose the distinction.
 *
 * Caveat, documented in the README: the rule is exact for indexes produced
 * with the default configuration (`degenerateScore` 0). A run configured with
 * a non-zero `degenerateScore` would make unassessed regions undetectable
 * from the emitted fields; that is an engine emission gap, not something this
 * package may paper over by recomputing degeneracy.
 */
export function isAssessed(decision: Pick<RegionDecision, "score" | "cohesion">): boolean {
  return !(decision.score === 0 && decision.cohesion === 0);
}

/** Summary of the recorded region decisions, framed assessed-only. */
export interface DecisionSummary {
  totalRegions: number;
  assessedRegions: number;
  unassessedRegions: number;
  /** Action split over ASSESSED regions only - a raw split is never emitted. */
  assessed: { preserve: number; reconstruct: number };
  userOverridden: number;
  /** Always-present honesty note explaining the assessed-only framing. */
  note: string;
}

/** Drop a region id's scheme prefix (`pkg:com.example` -> `com.example`). */
export function stripRegionScheme(regionId: string): string {
  const colon = regionId.indexOf(":");
  return colon === -1 ? regionId : regionId.slice(colon + 1);
}

/** The file's simple name from its `file:<path>` identifier. */
function fileSimpleName(id: string): string {
  const raw = id.startsWith("file:") ? id.slice("file:".length) : id;
  const segment = raw.split(/[\\/]/).filter(Boolean).pop();
  return segment ?? id;
}

/** Longest common dot-separated package prefix across the given paths. */
function commonPackagePrefix(paths: readonly string[]): string {
  const split = paths.filter((p) => p.length > 0).map((p) => p.split("."));
  if (split.length === 0) return "";
  let prefix = split[0]!;
  for (let i = 1; i < split.length; i++) {
    const other = split[i]!;
    let k = 0;
    while (k < prefix.length && k < other.length && prefix[k] === other[k]) k++;
    prefix = prefix.slice(0, k);
    if (prefix.length === 0) break;
  }
  return prefix.join(".");
}

export interface IndexView {
  /** Absolute path of the index directory this view was loaded from. */
  indexDir: string;
  hierarchy: Hierarchy;
  metadata: Metadata;
  /** Exact decision join: regionId -> recorded decision. */
  decisionsByRegion: Map<string, RegionDecision>;
  /** All recorded decisions in canonical (regionId-ascending) order. */
  decisionsSorted: RegionDecision[];
  /** Outgoing leaf edges by source id, each list sorted by target id. */
  dependenciesOf: Map<NodeId, LeafEdge[]>;
  /** Incoming leaf edges by target id, each list sorted by source id. */
  dependentsOf: Map<NodeId, LeafEdge[]>;
  /** Outgoing cross-group edges by source group id, sorted by target id. */
  groupDependenciesOf: Map<NodeId, CrossGroupEdge[]>;
  /** Incoming cross-group edges by target group id, sorted by source id. */
  groupDependentsOf: Map<NodeId, CrossGroupEdge[]>;
  /** Count of `file`-kind descendants per node (a file counts itself). */
  descendantFileCount: Map<NodeId, number>;
  /** Derived display prefix per group node (may be ""). */
  packagePrefixOf: Map<NodeId, string>;
  /** Member file count per region (nearest regioned ancestor, Gap 12). */
  regionMemberFileCount: Map<string, number>;
  /** Hierarchy node count per kind. */
  nodeKindCounts: Record<NodeKind, number>;
  /** Node ids per level, canonical order, level = array index. */
  idsByLevel: NodeId[][];
  summary: DecisionSummary;
}

/**
 * Derived display label. Never an identity - always presented next to the id:
 * - file: the path's simple name;
 * - group: the region's display name when provenance was recorded, else the
 *   derived package prefix when non-empty, else null;
 * - repository / class / function: null (their ids are already readable).
 */
export function displayNameOf(view: IndexView, node: HierarchyNode): string | null {
  if (node.kind === "file") return fileSimpleName(node.id);
  if (node.kind === "group") {
    if (node.regionId !== undefined) return stripRegionScheme(node.regionId);
    const prefix = view.packagePrefixOf.get(node.id) ?? "";
    return prefix.length > 0 ? prefix : null;
  }
  return null;
}

function decisionSummaryOf(decisions: readonly RegionDecision[]): DecisionSummary {
  let assessedCount = 0;
  let preserve = 0;
  let reconstruct = 0;
  let overridden = 0;
  for (const decision of decisions) {
    if (decision.userOverridden) overridden++;
    if (!isAssessed(decision)) continue;
    assessedCount++;
    if (decision.action === "preserve") preserve++;
    else reconstruct++;
  }
  const unassessed = decisions.length - assessedCount;
  const note =
    unassessed === 0
      ? "All recorded regions were assessed; the preserve/reconstruct split covers every region."
      : `The preserve/reconstruct split covers only the ${assessedCount} assessed region(s). ` +
        `${unassessed} of ${decisions.length} regions were never assessed (score === 0 && cohesion === 0 ` +
        `by the recorded rule; the engine emits no explicit flag). Their recorded decisionConfidence is ` +
        `the boundary distance of a rule-assigned zero score, not measured confidence - do not read it as evidence.`;
  return {
    totalRegions: decisions.length,
    assessedRegions: assessedCount,
    unassessedRegions: unassessed,
    assessed: { preserve, reconstruct },
    userOverridden: overridden,
    note,
  };
}

/** Precompute every join and roll-up the tools read. Pure and deterministic. */
export function buildIndexView(
  indexDir: string,
  parsed: { hierarchy: Hierarchy; metadata: Metadata },
): IndexView {
  const { hierarchy, metadata } = parsed;
  const { nodes, leafAttributes, leafEdges, crossGroupEdges } = hierarchy;

  const decisionsByRegion = new Map<string, RegionDecision>();
  for (const decision of metadata.regionDecisions) {
    decisionsByRegion.set(decision.regionId, decision);
  }
  const decisionsSorted = [...metadata.regionDecisions].sort((a, b) =>
    compareIds(a.regionId, b.regionId),
  );

  const dependenciesOf = new Map<NodeId, LeafEdge[]>();
  const dependentsOf = new Map<NodeId, LeafEdge[]>();
  for (const edge of leafEdges) {
    const out = dependenciesOf.get(edge.source);
    if (out) out.push(edge);
    else dependenciesOf.set(edge.source, [edge]);
    const incoming = dependentsOf.get(edge.target);
    if (incoming) incoming.push(edge);
    else dependentsOf.set(edge.target, [edge]);
  }
  for (const list of dependenciesOf.values()) list.sort((a, b) => compareIds(a.target, b.target));
  for (const list of dependentsOf.values()) list.sort((a, b) => compareIds(a.source, b.source));

  const groupDependenciesOf = new Map<NodeId, CrossGroupEdge[]>();
  const groupDependentsOf = new Map<NodeId, CrossGroupEdge[]>();
  for (const edge of crossGroupEdges) {
    const out = groupDependenciesOf.get(edge.source);
    if (out) out.push(edge);
    else groupDependenciesOf.set(edge.source, [edge]);
    const incoming = groupDependentsOf.get(edge.target);
    if (incoming) incoming.push(edge);
    else groupDependentsOf.set(edge.target, [edge]);
  }
  for (const list of groupDependenciesOf.values()) list.sort((a, b) => compareIds(a.target, b.target));
  for (const list of groupDependentsOf.values()) list.sort((a, b) => compareIds(a.source, b.source));

  // Bottom-up roll-ups (children always sit one level deeper than parents).
  const byLevelDesc = [...nodes.values()].sort((a, b) => b.level - a.level);
  const descendantFileCount = new Map<NodeId, number>();
  const packagePathsBelow = new Map<NodeId, Set<string>>();
  for (const node of byLevelDesc) {
    let files = node.kind === "file" ? 1 : 0;
    const packages = new Set<string>();
    const ownPackage = leafAttributes.get(node.id)?.packagePath;
    if (ownPackage) packages.add(ownPackage);
    for (const childId of node.childIds) {
      files += descendantFileCount.get(childId) ?? 0;
      const childPackages = packagePathsBelow.get(childId);
      if (childPackages) {
        for (const p of childPackages) packages.add(p);
      }
    }
    descendantFileCount.set(node.id, files);
    packagePathsBelow.set(node.id, packages);
  }
  const packagePrefixOf = new Map<NodeId, string>();
  for (const node of nodes.values()) {
    if (node.kind !== "group") continue;
    packagePrefixOf.set(
      node.id,
      commonPackagePrefix([...(packagePathsBelow.get(node.id) ?? [])].sort()),
    );
  }

  // Member file count per region: a file belongs to the region recorded on its
  // nearest ancestor group (Gap 12). Files whose ancestry carries no region
  // belong to no region - that absence is engine-recorded, not a guess.
  const regionMemberFileCount = new Map<string, number>();
  for (const node of nodes.values()) {
    if (node.kind !== "file") continue;
    let cursor: HierarchyNode | undefined = node.parentId ? nodes.get(node.parentId) : undefined;
    while (cursor && cursor.regionId === undefined) {
      cursor = cursor.parentId ? nodes.get(cursor.parentId) : undefined;
    }
    if (!cursor?.regionId) continue;
    regionMemberFileCount.set(cursor.regionId, (regionMemberFileCount.get(cursor.regionId) ?? 0) + 1);
  }

  const nodeKindCounts: Record<NodeKind, number> = {
    repository: 0,
    group: 0,
    file: 0,
    class: 0,
    function: 0,
  };
  const idsByLevel: NodeId[][] = [];
  for (const node of nodes.values()) {
    nodeKindCounts[node.kind]++;
    while (idsByLevel.length <= node.level) idsByLevel.push([]);
    idsByLevel[node.level]!.push(node.id);
  }
  for (const ids of idsByLevel) ids.sort(compareIds);

  return {
    indexDir,
    hierarchy,
    metadata,
    decisionsByRegion,
    decisionsSorted,
    dependenciesOf,
    dependentsOf,
    groupDependenciesOf,
    groupDependentsOf,
    descendantFileCount,
    packagePrefixOf,
    regionMemberFileCount,
    nodeKindCounts,
    idsByLevel,
    summary: decisionSummaryOf(metadata.regionDecisions),
  };
}
