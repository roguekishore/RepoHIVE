/**
 * The six read-only tool handlers, as pure functions over an {@link IndexView}.
 *
 * Each handler takes already-validated input (the MCP layer validates with
 * zod; direct callers get the same checks re-run here) and returns a
 * `ToolResult`: a value to serialize, or an agent-facing error message that
 * names what was wrong and what to try instead.
 *
 * Data-honesty rules, binding for every handler:
 * - Values are READ from the engine's output, never recomputed. Fields the
 *   engine did not emit are explicit `null`s, never invented values.
 * - Group-to-decision joins go through `regionId` / `ordinal` / `groupIds`
 *   only (Gap 12), never a path or package-prefix heuristic.
 * - A preserve/reconstruct split is only ever emitted framed assessed-only
 *   (see `isAssessed` in view.ts for the recorded unassessed-region rule).
 * - Every list is canonically ordered, and truncation is by an explicit
 *   `limit` over that canonical order with a `truncated` flag - so identical
 *   input yields identical output.
 */

import type { NodeKind } from "@repohive/shared";
import { analyzeBlastRadius, compareIds } from "@repohive/core";
import type { HierarchyNode, PerLevelStats, RegionDecision, RunConfiguration } from "@repohive/core";
import { displayNameOf, isAssessed, stripRegionScheme } from "./view.js";
import type { DecisionSummary, IndexView } from "./view.js";

export type ToolResult<T> = { ok: true; value: T } | { ok: false; message: string };

const ok = <T>(value: T): ToolResult<T> => ({ ok: true, value });
const fail = <T>(message: string): ToolResult<T> => ({ ok: false, message });

/** Defaults and bounds shared by the zod schemas (server.ts) and handlers. */
export const LIMITS = {
  hierarchyNodes: { default: 100, max: 500 },
  findMatches: { default: 20, max: 100 },
  detailEdges: { default: 100, max: 500 },
  detailChildren: { max: 50 },
  blastNodes: { default: 500, max: 2000 },
  regionDecisions: { default: 100, max: 500 },
} as const;

const ID_SHAPE_HINT =
  'Node ids look like "file:src/main/java/com/example/UserService.java", ' +
  '"class:com.example.UserService", "func:com.example.UserService#save(...)" ' +
  '(class/function ids may carry a "<source-root>|" prefix in multi-module repos), ' +
  'or "g_<hash>" for groups. Use find_node to look ids up from a path, package or name.';

function checkBounds(
  name: string,
  value: number | undefined,
  max: number,
): string | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > max) {
    return `${name} must be an integer between 1 and ${max}, got ${value}`;
  }
  return null;
}

function checkOffset(value: number | undefined): string | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 0) {
    return `offset must be a non-negative integer, got ${value}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared output fragments
// ---------------------------------------------------------------------------

/** Engine-recorded region provenance of a node; null when none was recorded. */
export interface RegionRef {
  regionId: string;
  /** This group's index within its region's canonical group list. */
  ordinal: number;
}

/** A recorded decision, briefly: enough to read the action honestly. */
export interface DecisionBrief {
  action: "preserve" | "reconstruct";
  /** False = the region was never assessed (recorded rule: score and cohesion both 0). */
  assessed: boolean;
  score: number;
  /** |score - boundary|. NOT informative when `assessed` is false. */
  decisionConfidence: number;
  userOverridden: boolean;
}

/** The full recorded decision, verbatim plus the derived `assessed` flag. */
export interface DecisionRecord extends DecisionBrief {
  regionId: string;
  /** Region id without its scheme prefix - a display aid. */
  displayName: string;
  cohesion: number;
  coupling: number;
  /** null when the run did not compute modularity. */
  modularity: number | null;
  automaticAction: "preserve" | "reconstruct";
  /** Group node ids this decision produced; null when the index predates the field. */
  groupIds: string[] | null;
  /** Files whose nearest regioned ancestor carries this region (a count). */
  memberFileCount: number;
}

function regionRefOf(node: HierarchyNode): RegionRef | null {
  return node.regionId !== undefined && node.ordinal !== undefined
    ? { regionId: node.regionId, ordinal: node.ordinal }
    : null;
}

function decisionBriefOf(view: IndexView, node: HierarchyNode): DecisionBrief | null {
  if (node.regionId === undefined) return null;
  const decision = view.decisionsByRegion.get(node.regionId);
  if (decision === undefined) return null;
  return {
    action: decision.action,
    assessed: isAssessed(decision),
    score: decision.score,
    decisionConfidence: decision.decisionConfidence,
    userOverridden: decision.userOverridden,
  };
}

function decisionRecordOf(view: IndexView, decision: RegionDecision): DecisionRecord {
  return {
    regionId: decision.regionId,
    displayName: stripRegionScheme(decision.regionId),
    assessed: isAssessed(decision),
    cohesion: decision.cohesion,
    coupling: decision.coupling,
    modularity: decision.modularity ?? null,
    score: decision.score,
    action: decision.action,
    automaticAction: decision.automaticAction,
    userOverridden: decision.userOverridden,
    decisionConfidence: decision.decisionConfidence,
    groupIds: decision.groupIds !== undefined ? [...decision.groupIds].sort(compareIds) : null,
    memberFileCount: view.regionMemberFileCount.get(decision.regionId) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// repository_overview
// ---------------------------------------------------------------------------

export interface RepositoryOverview {
  indexDir: string;
  repositoryId: string;
  /** Levels from the repository node (0) to the deepest leaf. */
  hierarchyDepth: number;
  /** Hierarchy nodes, including group and repository nodes. */
  nodeCount: number;
  /** Leaf edges + aggregated cross-group edges. */
  edgeCount: number;
  leafEdgeCount: number;
  crossGroupEdgeCount: number;
  averageBranchingFactor: number;
  nodeKindCounts: Record<NodeKind, number>;
  perLevel: PerLevelStats[];
  regionDecisions: DecisionSummary;
  structuralQualityBoundary: number;
  metricWeights: { cohesion: number; coupling: number; modularity: number | null };
  cohesionSquashConstant: number;
  /** The run's resolved configuration; null when the index predates the field. */
  configuration: RunConfiguration | null;
}

/**
 * The orientation call: repository shape, which levels exist (so
 * hierarchy_at_level can be called with real level numbers), and the honest
 * summary of the recorded preserve/reconstruct decisions.
 */
export function repositoryOverview(view: IndexView): ToolResult<RepositoryOverview> {
  const { hierarchy, metadata } = view;
  return ok({
    indexDir: view.indexDir,
    repositoryId: hierarchy.repositoryId,
    hierarchyDepth: metadata.hierarchyDepth,
    nodeCount: metadata.nodeCount,
    edgeCount: metadata.edgeCount,
    leafEdgeCount: hierarchy.leafEdges.length,
    crossGroupEdgeCount: metadata.totalCrossGroupEdges,
    averageBranchingFactor: metadata.averageBranchingFactor,
    nodeKindCounts: view.nodeKindCounts,
    perLevel: metadata.perLevel,
    regionDecisions: view.summary,
    structuralQualityBoundary: metadata.structuralQualityBoundary,
    metricWeights: {
      cohesion: metadata.metricWeights.cohesion,
      coupling: metadata.metricWeights.coupling,
      modularity: metadata.metricWeights.modularity ?? null,
    },
    cohesionSquashConstant: metadata.cohesionSquashConstant,
    configuration: metadata.configuration ?? null,
  });
}

// ---------------------------------------------------------------------------
// hierarchy_at_level
// ---------------------------------------------------------------------------

export interface LevelNode {
  id: string;
  kind: NodeKind;
  /** Derived display aid (see view.ts); null when nothing is derivable. */
  name: string | null;
  parentId: string | null;
  childCount: number;
  /** Count of file-kind descendants (a file counts itself). */
  descendantFileCount: number;
  /** Groups: derived common package prefix of member files; null otherwise. */
  packagePrefix: string | null;
  /** Leaf attributes; null on group/repository nodes or when the contract omitted the field. */
  packagePath: string | null;
  directoryPath: string | null;
  definedInFile: string | null;
  region: RegionRef | null;
  decision: DecisionBrief | null;
}

export interface HierarchyAtLevel {
  level: number;
  totalAtLevel: number;
  offset: number;
  returned: number;
  truncated: boolean;
  nodes: LevelNode[];
}

export interface HierarchyAtLevelInput {
  level: number;
  offset?: number;
  limit?: number;
}

function levelNodeOf(view: IndexView, node: HierarchyNode): LevelNode {
  const leaf = view.hierarchy.leafAttributes.get(node.id);
  const isGroup = node.kind === "group";
  return {
    id: node.id,
    kind: node.kind,
    name: displayNameOf(view, node),
    parentId: node.parentId,
    childCount: node.childIds.length,
    descendantFileCount: view.descendantFileCount.get(node.id) ?? 0,
    packagePrefix: isGroup ? (view.packagePrefixOf.get(node.id) ?? "") : null,
    packagePath: leaf?.packagePath ?? null,
    directoryPath: leaf !== undefined ? leaf.directoryPath : null,
    definedInFile: leaf?.definedInFile ?? null,
    region: regionRefOf(node),
    decision: decisionBriefOf(view, node),
  };
}

/**
 * Level-at-a-time structure: every node at one hierarchy level, canonically
 * ordered and paged. Level 0 is the repository node; level 1 is the top-level
 * architecture. Lets an agent read the tree one slice at a time instead of
 * pulling tens of thousands of nodes.
 */
export function hierarchyAtLevel(
  view: IndexView,
  input: HierarchyAtLevelInput,
): ToolResult<HierarchyAtLevel> {
  const boundsError =
    checkBounds("limit", input.limit, LIMITS.hierarchyNodes.max) ?? checkOffset(input.offset);
  if (boundsError !== null) return fail(boundsError);
  const depth = view.hierarchy.depth;
  if (!Number.isInteger(input.level) || input.level < 0 || input.level > depth) {
    return fail(
      `level ${input.level} is out of range: this hierarchy has levels 0 (repository) to ${depth}. ` +
        `Call repository_overview to see per-level node counts.`,
    );
  }
  const limit = input.limit ?? LIMITS.hierarchyNodes.default;
  const offset = input.offset ?? 0;
  const ids = view.idsByLevel[input.level] ?? [];
  const page = ids.slice(offset, offset + limit);
  return ok({
    level: input.level,
    totalAtLevel: ids.length,
    offset,
    returned: page.length,
    truncated: offset + page.length < ids.length,
    nodes: page.map((id) => levelNodeOf(view, view.hierarchy.nodes.get(id)!)),
  });
}

// ---------------------------------------------------------------------------
// find_node
// ---------------------------------------------------------------------------

export type MatchedField = "id" | "packagePath" | "directoryPath" | "packagePrefix" | "regionId";

export interface FoundNode {
  id: string;
  kind: NodeKind;
  level: number;
  name: string | null;
  /** The first field (in the fixed order id, packagePath, directoryPath, packagePrefix, regionId) that matched. */
  matchedOn: MatchedField;
  packagePath: string | null;
  directoryPath: string | null;
  region: RegionRef | null;
}

export interface FindNodeResult {
  query: string;
  totalMatches: number;
  returned: number;
  truncated: boolean;
  matches: FoundNode[];
}

export interface FindNodeInput {
  query: string;
  kind?: NodeKind;
  limit?: number;
}

/**
 * The bridge from names an agent knows (file paths, class names, package
 * names) to the node ids every other tool takes. Case-insensitive substring
 * match; exact id matches rank first, then id substrings, then attribute
 * matches; ties break on ascending id, so results are deterministic.
 */
export function findNode(view: IndexView, input: FindNodeInput): ToolResult<FindNodeResult> {
  const boundsError = checkBounds("limit", input.limit, LIMITS.findMatches.max);
  if (boundsError !== null) return fail(boundsError);
  const query = input.query.trim();
  if (query.length === 0) return fail("query must be a non-empty string");
  const limit = input.limit ?? LIMITS.findMatches.default;
  const needle = query.toLowerCase();

  const scored: Array<{ rank: number; node: HierarchyNode; matchedOn: MatchedField }> = [];
  for (const node of view.hierarchy.nodes.values()) {
    if (input.kind !== undefined && node.kind !== input.kind) continue;
    const leaf = view.hierarchy.leafAttributes.get(node.id);
    const fields: Array<[MatchedField, string | undefined]> = [
      ["id", node.id],
      ["packagePath", leaf?.packagePath],
      ["directoryPath", leaf?.directoryPath],
      ["packagePrefix", node.kind === "group" ? view.packagePrefixOf.get(node.id) : undefined],
      ["regionId", node.regionId],
    ];
    for (const [matchedOn, value] of fields) {
      if (value === undefined || value.length === 0) continue;
      const haystack = value.toLowerCase();
      if (!haystack.includes(needle)) continue;
      const rank = matchedOn === "id" ? (haystack === needle ? 0 : 1) : 2;
      scored.push({ rank, node, matchedOn });
      break;
    }
  }
  scored.sort((a, b) => a.rank - b.rank || compareIds(a.node.id, b.node.id));

  const page = scored.slice(0, limit);
  return ok({
    query,
    totalMatches: scored.length,
    returned: page.length,
    truncated: page.length < scored.length,
    matches: page.map(({ node, matchedOn }) => {
      const leaf = view.hierarchy.leafAttributes.get(node.id);
      return {
        id: node.id,
        kind: node.kind,
        level: node.level,
        name: displayNameOf(view, node),
        matchedOn,
        packagePath: leaf?.packagePath ?? null,
        directoryPath: leaf !== undefined ? leaf.directoryPath : null,
        region: regionRefOf(node),
      };
    }),
  });
}

// ---------------------------------------------------------------------------
// node_details
// ---------------------------------------------------------------------------

export interface LeafEdgeOut {
  target: string;
  importFrequency: number;
  methodCallFrequency: number;
  sharedTypeCount: number;
  strength: number;
}

export interface LeafEdgeIn {
  source: string;
  importFrequency: number;
  methodCallFrequency: number;
  sharedTypeCount: number;
  strength: number;
}

export interface GroupEdgeOut {
  target: string;
  level: number;
  weight: number;
}

export interface GroupEdgeIn {
  source: string;
  level: number;
  weight: number;
}

export interface NodeDetails {
  id: string;
  kind: NodeKind;
  level: number;
  name: string | null;
  parentId: string | null;
  /** Root-first ancestor chain (repository down to the direct parent). */
  ancestors: Array<{ id: string; kind: NodeKind; level: number; name: string | null }>;
  childCount: number;
  childrenTruncated: boolean;
  children: Array<{ id: string; kind: NodeKind; name: string | null }>;
  descendantFileCount: number;
  packagePrefix: string | null;
  packagePath: string | null;
  directoryPath: string | null;
  definedInFile: string | null;
  region: RegionRef | null;
  /** Full recorded decision for a group with region provenance; null otherwise. */
  decision: DecisionRecord | null;
  /** Direct leaf dependency edges (file/class/function nodes); null on group/repository nodes. */
  dependencies: { total: number; truncated: boolean; edges: LeafEdgeOut[] } | null;
  dependents: { total: number; truncated: boolean; edges: LeafEdgeIn[] } | null;
  /** Aggregated same-level cross-group edges (group nodes); null on other kinds. */
  groupDependencies: { total: number; truncated: boolean; edges: GroupEdgeOut[] } | null;
  groupDependents: { total: number; truncated: boolean; edges: GroupEdgeIn[] } | null;
}

export interface NodeDetailsInput {
  nodeId: string;
  edgeLimit?: number;
}

/**
 * Everything the index records about one node: its place in the hierarchy,
 * leaf attributes, engine-recorded region provenance, the joined decision (for
 * groups), and its direct one-hop edges in both directions - the surface's
 * answer to "what does X depend on / who depends on X" (blast_radius answers
 * the transitive version, in the dependents direction only).
 */
export function nodeDetails(view: IndexView, input: NodeDetailsInput): ToolResult<NodeDetails> {
  const boundsError = checkBounds("edgeLimit", input.edgeLimit, LIMITS.detailEdges.max);
  if (boundsError !== null) return fail(boundsError);
  const nodeId = input.nodeId.trim();
  if (nodeId.length === 0) return fail(`nodeId must be a non-empty string. ${ID_SHAPE_HINT}`);
  const node = view.hierarchy.nodes.get(nodeId);
  if (node === undefined) {
    return fail(`node not found: "${nodeId}". ${ID_SHAPE_HINT}`);
  }
  const edgeLimit = input.edgeLimit ?? LIMITS.detailEdges.default;

  const ancestors: NodeDetails["ancestors"] = [];
  let cursor = node.parentId !== null ? view.hierarchy.nodes.get(node.parentId) : undefined;
  while (cursor !== undefined) {
    ancestors.push({
      id: cursor.id,
      kind: cursor.kind,
      level: cursor.level,
      name: displayNameOf(view, cursor),
    });
    cursor = cursor.parentId !== null ? view.hierarchy.nodes.get(cursor.parentId) : undefined;
  }
  ancestors.reverse();

  const children = node.childIds.slice(0, LIMITS.detailChildren.max).map((childId) => {
    const child = view.hierarchy.nodes.get(childId)!;
    return { id: child.id, kind: child.kind, name: displayNameOf(view, child) };
  });

  const leaf = view.hierarchy.leafAttributes.get(node.id);
  const isLeafKind = node.kind === "file" || node.kind === "class" || node.kind === "function";
  const isGroup = node.kind === "group";

  const outgoing = view.dependenciesOf.get(node.id) ?? [];
  const incoming = view.dependentsOf.get(node.id) ?? [];
  const groupOutgoing = view.groupDependenciesOf.get(node.id) ?? [];
  const groupIncoming = view.groupDependentsOf.get(node.id) ?? [];

  const fullDecision =
    isGroup && node.regionId !== undefined
      ? view.decisionsByRegion.get(node.regionId)
      : undefined;

  return ok({
    id: node.id,
    kind: node.kind,
    level: node.level,
    name: displayNameOf(view, node),
    parentId: node.parentId,
    ancestors,
    childCount: node.childIds.length,
    childrenTruncated: children.length < node.childIds.length,
    children,
    descendantFileCount: view.descendantFileCount.get(node.id) ?? 0,
    packagePrefix: isGroup ? (view.packagePrefixOf.get(node.id) ?? "") : null,
    packagePath: leaf?.packagePath ?? null,
    directoryPath: leaf !== undefined ? leaf.directoryPath : null,
    definedInFile: leaf?.definedInFile ?? null,
    region: regionRefOf(node),
    decision: fullDecision !== undefined ? decisionRecordOf(view, fullDecision) : null,
    dependencies: isLeafKind
      ? {
          total: outgoing.length,
          truncated: outgoing.length > edgeLimit,
          edges: outgoing.slice(0, edgeLimit).map((edge) => ({
            target: edge.target,
            importFrequency: edge.importFrequency,
            methodCallFrequency: edge.methodCallFrequency,
            sharedTypeCount: edge.sharedTypeCount,
            strength: edge.strength,
          })),
        }
      : null,
    dependents: isLeafKind
      ? {
          total: incoming.length,
          truncated: incoming.length > edgeLimit,
          edges: incoming.slice(0, edgeLimit).map((edge) => ({
            source: edge.source,
            importFrequency: edge.importFrequency,
            methodCallFrequency: edge.methodCallFrequency,
            sharedTypeCount: edge.sharedTypeCount,
            strength: edge.strength,
          })),
        }
      : null,
    groupDependencies: isGroup
      ? {
          total: groupOutgoing.length,
          truncated: groupOutgoing.length > edgeLimit,
          edges: groupOutgoing.slice(0, edgeLimit).map((edge) => ({
            target: edge.target,
            level: edge.level,
            weight: edge.weight,
          })),
        }
      : null,
    groupDependents: isGroup
      ? {
          total: groupIncoming.length,
          truncated: groupIncoming.length > edgeLimit,
          edges: groupIncoming.slice(0, edgeLimit).map((edge) => ({
            source: edge.source,
            level: edge.level,
            weight: edge.weight,
          })),
        }
      : null,
  });
}

// ---------------------------------------------------------------------------
// blast_radius
// ---------------------------------------------------------------------------

export interface BlastRadiusResult {
  nodeId: string;
  /** Impacted nodes, including the queried node itself (engine semantics). */
  impactedNodeCount: number;
  kindBreakdown: Record<NodeKind, number>;
  impactedNodes: string[];
  truncated: boolean;
  containingGroupCount: number;
  containingGroups: Array<{ id: string; name: string | null; regionId: string | null }>;
  containingGroupsTruncated: boolean;
}

export interface BlastRadiusInput {
  nodeId: string;
  limit?: number;
}

/**
 * Change-impact scoping: the engine's reverse-reachability analysis. Given a
 * node about to change, every node with a dependency path reaching it, plus
 * the group nodes containing any impacted leaf - which files and which parts
 * of the architecture to re-check before an edit.
 */
export function blastRadius(view: IndexView, input: BlastRadiusInput): ToolResult<BlastRadiusResult> {
  const boundsError = checkBounds("limit", input.limit, LIMITS.blastNodes.max);
  if (boundsError !== null) return fail(boundsError);
  const nodeId = input.nodeId.trim();
  if (nodeId.length === 0) return fail(`nodeId must be a non-empty string. ${ID_SHAPE_HINT}`);
  const limit = input.limit ?? LIMITS.blastNodes.default;

  const analyzed = analyzeBlastRadius(view.hierarchy, nodeId);
  if (!analyzed.ok) {
    if (analyzed.error.code === "NODE_NOT_FOUND") {
      return fail(`node not found: "${nodeId}". ${ID_SHAPE_HINT}`);
    }
    if (analyzed.error.code === "EMPTY_NODE_ID") {
      return fail(`nodeId must be a non-empty string. ${ID_SHAPE_HINT}`);
    }
    return fail(`blast radius failed: ${analyzed.error.code}`);
  }

  const { nodes: impacted, groupNodes } = analyzed.value;
  const kindBreakdown: Record<NodeKind, number> = {
    repository: 0,
    group: 0,
    file: 0,
    class: 0,
    function: 0,
  };
  for (const id of impacted) {
    const kind = view.hierarchy.nodes.get(id)?.kind;
    if (kind !== undefined) kindBreakdown[kind]++;
  }

  const groups = groupNodes.slice(0, limit).map((id) => {
    const groupNode = view.hierarchy.nodes.get(id)!;
    return {
      id,
      name: displayNameOf(view, groupNode),
      regionId: groupNode.regionId ?? null,
    };
  });

  return ok({
    nodeId,
    impactedNodeCount: impacted.length,
    kindBreakdown,
    impactedNodes: impacted.slice(0, limit),
    truncated: impacted.length > limit,
    containingGroupCount: groupNodes.length,
    containingGroups: groups,
    containingGroupsTruncated: groupNodes.length > limit,
  });
}

// ---------------------------------------------------------------------------
// region_decisions
// ---------------------------------------------------------------------------

export interface RegionDecisionsResult {
  structuralQualityBoundary: number;
  metricWeights: { cohesion: number; coupling: number; modularity: number | null };
  cohesionSquashConstant: number;
  /** Recorded community-detection seed; null when the index predates configuration. */
  communityDetectionSeed: number | null;
  /** Summary over ALL recorded decisions, regardless of the filters below. */
  summary: DecisionSummary;
  totalMatching: number;
  offset: number;
  returned: number;
  truncated: boolean;
  regions: DecisionRecord[];
}

export interface RegionDecisionsInput {
  action?: "preserve" | "reconstruct";
  /** true = assessed regions only; false = unassessed only; absent = all. */
  assessed?: boolean;
  regionId?: string;
  /** Return only the decision that produced this group node (exact Gap 12 join). */
  groupId?: string;
  offset?: number;
  limit?: number;
}

/**
 * The recorded per-region preserve/reconstruct decisions - the audit trail of
 * the adaptive grouping, with structural-quality score, cohesion/coupling,
 * confidence, and the group nodes each decision produced. What an agent does
 * with it: calibrate trust in authored package boundaries (preserved,
 * high-score regions are boundaries worth respecting; reconstructed regions
 * flag packages whose structure did not hold), and explain why the hierarchy
 * groups files the way it does.
 */
export function regionDecisions(
  view: IndexView,
  input: RegionDecisionsInput,
): ToolResult<RegionDecisionsResult> {
  const boundsError =
    checkBounds("limit", input.limit, LIMITS.regionDecisions.max) ?? checkOffset(input.offset);
  if (boundsError !== null) return fail(boundsError);
  const limit = input.limit ?? LIMITS.regionDecisions.default;
  const offset = input.offset ?? 0;

  let candidates = view.decisionsSorted;

  if (input.regionId !== undefined) {
    const match = view.decisionsByRegion.get(input.regionId);
    if (match === undefined) {
      return fail(
        `unknown regionId: "${input.regionId}". Region ids look like "pkg:com.example.orders" or ` +
          `"dir:src/orders"; list them with region_decisions (no filters) or find them on group nodes ` +
          `via node_details.`,
      );
    }
    candidates = [match];
  }

  if (input.groupId !== undefined) {
    const groupNode = view.hierarchy.nodes.get(input.groupId);
    if (groupNode === undefined) {
      return fail(`node not found: "${input.groupId}". ${ID_SHAPE_HINT}`);
    }
    if (groupNode.kind !== "group") {
      return fail(
        `"${input.groupId}" is a ${groupNode.kind} node, not a group. Only group nodes join to region decisions.`,
      );
    }
    if (groupNode.regionId === undefined) {
      return fail(
        `group "${input.groupId}" carries no region provenance: it is either a repository fan-out ` +
          `wrapper (belongs to no region by construction) or the index predates provenance emission ` +
          `(Gap 12). No decision maps to it.`,
      );
    }
    const regionId = groupNode.regionId;
    candidates = candidates.filter((decision) => decision.regionId === regionId);
  }

  if (input.action !== undefined) {
    candidates = candidates.filter((decision) => decision.action === input.action);
  }
  if (input.assessed !== undefined) {
    candidates = candidates.filter((decision) => isAssessed(decision) === input.assessed);
  }

  const page = candidates.slice(offset, offset + limit);
  return ok({
    structuralQualityBoundary: view.metadata.structuralQualityBoundary,
    metricWeights: {
      cohesion: view.metadata.metricWeights.cohesion,
      coupling: view.metadata.metricWeights.coupling,
      modularity: view.metadata.metricWeights.modularity ?? null,
    },
    cohesionSquashConstant: view.metadata.cohesionSquashConstant,
    communityDetectionSeed: view.metadata.configuration?.communityDetectionSeed ?? null,
    summary: view.summary,
    totalMatching: candidates.length,
    offset,
    returned: page.length,
    truncated: offset + page.length < candidates.length,
    regions: page.map((decision) => decisionRecordOf(view, decision)),
  });
}
