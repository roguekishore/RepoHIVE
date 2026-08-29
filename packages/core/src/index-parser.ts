/**
 * Index_Parser (Requirement 9): read an Index_File_Set back into the
 * in-memory model with full fidelity — same node set, edge set, per-Region
 * decisions, and depth (9.5). Atomic failure: ALL missing member files are
 * reported in one MISSING_FILES error (9.6); malformed JSON or a missing
 * required field is reported as MALFORMED_FILE naming the file (9.7); no
 * partial Hierarchy is ever returned.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GraphNode, NodeId } from "@repohive/shared";
import { compareIds } from "./canonical.js";
import { err, ok, type Result } from "./errors.js";
import { INDEX_FILE_NAMES } from "./index-serializer.js";
import type { CrossGroupEdge, Hierarchy, HierarchyNode, Metadata } from "./types.js";

/** The node kinds a hierarchy may contain (contract: NodeKind). */
const HIERARCHY_KINDS = new Set<string>(["file", "class", "function", "group", "repository"]);

/**
 * Whether a parsed JSON array element can have its fields read.
 *
 * `JSON.parse` happily yields `null` and primitives inside an array, and every
 * validation loop below reads `entry.<field>` — so a `null` element raised a
 * `TypeError` straight out of `parseIndex`, escaping the Result model that the
 * whole error taxonomy is built on (Fix 2 — Gap 3).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Hierarchy depth: the deepest level present, matching the builder's measure. */
function depthOf(nodes: ReadonlyMap<NodeId, HierarchyNode>): number {
  let maxLevel = 0;
  for (const node of nodes.values()) {
    if (node.level > maxLevel) {
      maxLevel = node.level;
    }
  }
  return maxLevel;
}

export function parseIndex(dir: string): Result<{ hierarchy: Hierarchy; metadata: Metadata }> {
  const missing = INDEX_FILE_NAMES.filter((name) => !existsSync(join(dir, name)));
  if (missing.length > 0) {
    return err({ code: "MISSING_FILES", files: missing });
  }

  const raw: Record<string, unknown> = {};
  for (const name of INDEX_FILE_NAMES) {
    let text: string;
    try {
      text = readFileSync(join(dir, name), "utf8");
    } catch {
      return err({ code: "MALFORMED_FILE", file: name, detail: "file could not be read" });
    }
    try {
      raw[name] = JSON.parse(text);
    } catch (cause) {
      return err({ code: "MALFORMED_FILE", file: name, detail: `invalid JSON: ${String(cause)}` });
    }
  }

  // --- hierarchy.json → the tree ------------------------------------------
  const hierarchyDoc = raw["hierarchy.json"] as { repositoryId?: unknown; nodes?: unknown };
  if (typeof hierarchyDoc?.repositoryId !== "string" || !Array.isArray(hierarchyDoc.nodes)) {
    return err({ code: "MALFORMED_FILE", file: "hierarchy.json", detail: "missing repositoryId or nodes" });
  }
  const nodes = new Map<NodeId, HierarchyNode>();
  for (const entry of hierarchyDoc.nodes as unknown[]) {
    if (!isRecord(entry)) {
      return err({ code: "MALFORMED_FILE", file: "hierarchy.json", detail: "node entry is not an object" });
    }
    if (
      typeof entry.id !== "string" ||
      typeof entry.kind !== "string" ||
      typeof entry.level !== "number" ||
      !Number.isInteger(entry.level) ||
      (entry.parentId !== null && typeof entry.parentId !== "string") ||
      !Array.isArray(entry.childIds) ||
      !(entry.childIds as unknown[]).every((c) => typeof c === "string")
    ) {
      return err({ code: "MALFORMED_FILE", file: "hierarchy.json", detail: "node entry missing a required field" });
    }
    if (!HIERARCHY_KINDS.has(entry.kind)) {
      return err({
        code: "MALFORMED_FILE",
        file: "hierarchy.json",
        detail: `unknown node kind "${entry.kind}" on ${entry.id}`,
      });
    }
    if (entry.level < 0) {
      return err({
        code: "MALFORMED_FILE",
        file: "hierarchy.json",
        detail: `node ${entry.id} has a negative level ${entry.level}`,
      });
    }
    if (nodes.has(entry.id)) {
      return err({ code: "MALFORMED_FILE", file: "hierarchy.json", detail: `duplicate node entry: ${entry.id}` });
    }
    nodes.set(entry.id, {
      id: entry.id,
      kind: entry.kind as HierarchyNode["kind"],
      level: entry.level,
      parentId: entry.parentId as NodeId | null,
      childIds: entry.childIds as NodeId[],
    });
  }

  // Referential integrity of the containment tree: every parent/child link
  // must point at an existing node and agree in both directions.
  for (const node of nodes.values()) {
    if (node.parentId !== null && !nodes.has(node.parentId)) {
      return err({
        code: "MALFORMED_FILE",
        file: "hierarchy.json",
        detail: `node ${node.id} has an unknown parentId ${node.parentId}`,
      });
    }
    for (const childId of node.childIds) {
      const child = nodes.get(childId);
      if (child === undefined) {
        return err({
          code: "MALFORMED_FILE",
          file: "hierarchy.json",
          detail: `node ${node.id} lists an unknown child ${childId}`,
        });
      }
      if (child.parentId !== node.id) {
        return err({
          code: "MALFORMED_FILE",
          file: "hierarchy.json",
          detail: `child ${childId} does not point back at parent ${node.id}`,
        });
      }
    }
  }

  // Global tree validation (Gap 11). The pairwise checks above prove every link
  // points somewhere real, but they say nothing about the shape as a whole: a
  // two-node mutual parent cycle satisfies every one of them, and parseIndex
  // accepted it — after which analyzeBlastRadius's ancestor climb never
  // terminated. Cycle-freedom, single-rootedness, reachability and level
  // monotonicity all fall out of one BFS, so this is a single pass rather than
  // four separate checks.
  const roots = [...nodes.values()].filter((node) => node.parentId === null);
  if (roots.length !== 1 || roots[0]!.id !== hierarchyDoc.repositoryId) {
    return err({
      code: "MALFORMED_FILE",
      file: "hierarchy.json",
      detail: `expected exactly one root equal to repositoryId, found ${roots.length}`,
    });
  }

  const seen = new Set<NodeId>([hierarchyDoc.repositoryId]);
  const queue: NodeId[] = [hierarchyDoc.repositoryId];
  while (queue.length > 0) {
    const node = nodes.get(queue.shift()!)!;
    const childIds = node.childIds;
    for (let i = 0; i < childIds.length; i++) {
      const childId = childIds[i]!;
      if (i > 0 && compareIds(childIds[i - 1]!, childId) >= 0) {
        // Req 7.5's canonical child ordering is a checkable invariant, and
        // requiring it strictly also rejects duplicates within one childIds.
        return err({
          code: "MALFORMED_FILE",
          file: "hierarchy.json",
          detail: `children of ${node.id} are not strictly ascending at ${childId}`,
        });
      }
      if (seen.has(childId)) {
        // A tree is exactly "every node reached once from a single root", so
        // this one test catches both a containment cycle and a shared child
        // (a DAG that is not a tree).
        return err({
          code: "MALFORMED_FILE",
          file: "hierarchy.json",
          detail: `containment cycle or shared child at ${childId}`,
        });
      }
      const child = nodes.get(childId)!; // existence already verified pairwise
      if (child.level !== node.level + 1) {
        return err({
          code: "MALFORMED_FILE",
          file: "hierarchy.json",
          detail: `child ${childId} has level ${child.level}, expected ${node.level + 1}`,
        });
      }
      seen.add(childId);
      queue.push(childId);
    }
  }
  if (seen.size !== nodes.size) {
    // Catches disconnected components, including a cycle that the BFS never
    // reaches from the root and so could not have detected above.
    return err({
      code: "MALFORMED_FILE",
      file: "hierarchy.json",
      detail: `${nodes.size - seen.size} node(s) are unreachable from the repository root`,
    });
  }

  // --- nodes.json → leaf attributes ----------------------------------------
  const nodesDoc = raw["nodes.json"] as { nodes?: unknown };
  if (!Array.isArray(nodesDoc?.nodes)) {
    return err({ code: "MALFORMED_FILE", file: "nodes.json", detail: "missing nodes" });
  }
  if ((nodesDoc.nodes as unknown[]).length !== nodes.size) {
    return err({
      code: "MALFORMED_FILE",
      file: "nodes.json",
      detail: `node count ${(nodesDoc.nodes as unknown[]).length} does not match hierarchy.json (${nodes.size})`,
    });
  }
  const leafAttributes = new Map<NodeId, GraphNode>();
  const seenNodeEntries = new Set<NodeId>();
  for (const entry of nodesDoc.nodes as unknown[]) {
    if (!isRecord(entry)) {
      return err({ code: "MALFORMED_FILE", file: "nodes.json", detail: "node entry is not an object" });
    }
    if (typeof entry.id !== "string" || typeof entry.kind !== "string") {
      return err({ code: "MALFORMED_FILE", file: "nodes.json", detail: "node entry missing a required field" });
    }
    if (!HIERARCHY_KINDS.has(entry.kind)) {
      return err({
        code: "MALFORMED_FILE",
        file: "nodes.json",
        detail: `unknown node kind "${entry.kind}" on ${entry.id}`,
      });
    }
    if (!nodes.has(entry.id)) {
      return err({ code: "MALFORMED_FILE", file: "nodes.json", detail: `unknown node id ${entry.id}` });
    }
    if (seenNodeEntries.has(entry.id)) {
      return err({ code: "MALFORMED_FILE", file: "nodes.json", detail: `duplicate node entry: ${entry.id}` });
    }
    seenNodeEntries.add(entry.id);

    // Region provenance is optional (Gap 12): indexes written before these
    // fields existed must still parse.
    if (entry.regionId !== undefined || entry.ordinal !== undefined) {
      if (typeof entry.regionId !== "string" || !Number.isInteger(entry.ordinal)) {
        return err({
          code: "MALFORMED_FILE",
          file: "nodes.json",
          detail: `node ${entry.id} carries incomplete region provenance (regionId and ordinal go together)`,
        });
      }
      const node = nodes.get(entry.id)!;
      node.regionId = entry.regionId;
      node.ordinal = entry.ordinal as number;
    }

    if (entry.kind === "file" || entry.kind === "class" || entry.kind === "function") {
      leafAttributes.set(entry.id, {
        id: entry.id,
        kind: entry.kind,
        ...(typeof entry.packagePath === "string" ? { packagePath: entry.packagePath } : {}),
        directoryPath: typeof entry.directoryPath === "string" ? entry.directoryPath : "",
        ...(typeof entry.definedInFile === "string" ? { definedInFile: entry.definedInFile } : {}),
      });
    }
  }

  // --- edges.json -----------------------------------------------------------
  const edgesDoc = raw["edges.json"] as { leafEdges?: unknown; crossGroupEdges?: unknown };
  if (!Array.isArray(edgesDoc?.leafEdges) || !Array.isArray(edgesDoc.crossGroupEdges)) {
    return err({ code: "MALFORMED_FILE", file: "edges.json", detail: "missing leafEdges or crossGroupEdges" });
  }
  const leafEdges: Hierarchy["leafEdges"] = [];
  for (const entry of edgesDoc.leafEdges as unknown[]) {
    if (!isRecord(entry)) {
      return err({ code: "MALFORMED_FILE", file: "edges.json", detail: "leaf edge entry is not an object" });
    }
    if (
      typeof entry.source !== "string" ||
      typeof entry.target !== "string" ||
      typeof entry.importFrequency !== "number" ||
      typeof entry.methodCallFrequency !== "number" ||
      typeof entry.sharedTypeCount !== "number" ||
      typeof entry.strength !== "number"
    ) {
      return err({ code: "MALFORMED_FILE", file: "edges.json", detail: "leaf edge missing a required field" });
    }
    if (!nodes.has(entry.source) || !nodes.has(entry.target)) {
      return err({
        code: "MALFORMED_FILE",
        file: "edges.json",
        detail: `leaf edge references an unknown node: ${entry.source} -> ${entry.target}`,
      });
    }
    leafEdges.push({
      source: entry.source,
      target: entry.target,
      importFrequency: entry.importFrequency,
      methodCallFrequency: entry.methodCallFrequency,
      sharedTypeCount: entry.sharedTypeCount,
      strength: entry.strength,
    });
  }
  const crossGroupEdges: CrossGroupEdge[] = [];
  for (const entry of edgesDoc.crossGroupEdges as unknown[]) {
    if (!isRecord(entry)) {
      return err({ code: "MALFORMED_FILE", file: "edges.json", detail: "cross-group edge entry is not an object" });
    }
    if (
      typeof entry.source !== "string" ||
      typeof entry.target !== "string" ||
      typeof entry.level !== "number" ||
      typeof entry.weight !== "number"
    ) {
      return err({ code: "MALFORMED_FILE", file: "edges.json", detail: "cross-group edge missing a required field" });
    }
    if (!nodes.has(entry.source) || !nodes.has(entry.target)) {
      return err({
        code: "MALFORMED_FILE",
        file: "edges.json",
        detail: `cross-group edge references an unknown node: ${entry.source} -> ${entry.target}`,
      });
    }
    crossGroupEdges.push({
      source: entry.source,
      target: entry.target,
      level: entry.level,
      weight: entry.weight,
    });
  }

  // --- repository.json + metadata.json --------------------------------------
  const repositoryDoc = raw["repository.json"] as {
    repositoryId?: unknown;
    hierarchyDepth?: unknown;
    nodeCount?: unknown;
    edgeCount?: unknown;
  };
  if (typeof repositoryDoc?.repositoryId !== "string" || typeof repositoryDoc.hierarchyDepth !== "number") {
    return err({ code: "MALFORMED_FILE", file: "repository.json", detail: "missing repositoryId or hierarchyDepth" });
  }
  if (!Number.isInteger(repositoryDoc.hierarchyDepth) || repositoryDoc.hierarchyDepth < 0) {
    return err({
      code: "MALFORMED_FILE",
      file: "repository.json",
      detail: `hierarchyDepth must be a non-negative integer, got ${repositoryDoc.hierarchyDepth}`,
    });
  }
  if (repositoryDoc.repositoryId !== hierarchyDoc.repositoryId) {
    return err({
      code: "MALFORMED_FILE",
      file: "repository.json",
      detail: "repositoryId does not match hierarchy.json",
    });
  }

  const metadata = raw["metadata.json"] as Metadata;
  if (!isRecord(metadata)) {
    return err({ code: "MALFORMED_FILE", file: "metadata.json", detail: "document is not an object" });
  }
  if (
    typeof metadata?.structuralQualityBoundary !== "number" ||
    typeof metadata.cohesionSquashConstant !== "number" ||
    typeof metadata.nodeCount !== "number" ||
    typeof metadata.edgeCount !== "number" ||
    typeof metadata.hierarchyDepth !== "number" ||
    typeof metadata.totalCrossGroupEdges !== "number" ||
    typeof metadata.averageBranchingFactor !== "number" ||
    !Array.isArray(metadata.regionDecisions) ||
    !Array.isArray(metadata.perLevel) ||
    typeof metadata.metricWeights !== "object" ||
    metadata.metricWeights === null ||
    typeof metadata.metricWeights.cohesion !== "number" ||
    typeof metadata.metricWeights.coupling !== "number"
  ) {
    return err({ code: "MALFORMED_FILE", file: "metadata.json", detail: "missing a required field" });
  }
  for (const decision of metadata.regionDecisions as unknown as unknown[]) {
    if (!isRecord(decision)) {
      return err({ code: "MALFORMED_FILE", file: "metadata.json", detail: "region decision is not an object" });
    }
    if (
      typeof decision.regionId !== "string" ||
      typeof decision.cohesion !== "number" ||
      typeof decision.coupling !== "number" ||
      typeof decision.score !== "number" ||
      (decision.action !== "preserve" && decision.action !== "reconstruct") ||
      (decision.automaticAction !== "preserve" && decision.automaticAction !== "reconstruct") ||
      typeof decision.userOverridden !== "boolean" ||
      typeof decision.decisionConfidence !== "number"
    ) {
      return err({ code: "MALFORMED_FILE", file: "metadata.json", detail: "region decision missing a required field" });
    }
    if (decision["groupIds"] !== undefined) {
      const groupIds = decision["groupIds"];
      if (!Array.isArray(groupIds) || !groupIds.every((id) => typeof id === "string")) {
        return err({
          code: "MALFORMED_FILE",
          file: "metadata.json",
          detail: `region decision ${String(decision["regionId"])} has a malformed groupIds array`,
        });
      }
      for (const groupId of groupIds as string[]) {
        if (!nodes.has(groupId)) {
          return err({
            code: "MALFORMED_FILE",
            file: "metadata.json",
            detail: `region decision ${String(decision["regionId"])} names an unknown group ${groupId}`,
          });
        }
      }
    }
  }
  for (const level of metadata.perLevel as unknown as unknown[]) {
    if (!isRecord(level)) {
      return err({ code: "MALFORMED_FILE", file: "metadata.json", detail: "per-level entry is not an object" });
    }
    if (
      typeof level.level !== "number" ||
      typeof level.groupNodeCount !== "number" ||
      typeof level.leafNodeCount !== "number" ||
      typeof level.leafEdgeCount !== "number" ||
      typeof level.crossGroupEdgeCount !== "number"
    ) {
      return err({ code: "MALFORMED_FILE", file: "metadata.json", detail: "per-level entry missing a required field" });
    }
    for (const field of ["level", "groupNodeCount", "leafNodeCount", "leafEdgeCount", "crossGroupEdgeCount"] as const) {
      const value = level[field];
      if (!Number.isInteger(value) || (value as number) < 0) {
        return err({
          code: "MALFORMED_FILE",
          file: "metadata.json",
          detail: `per-level ${field} must be a non-negative integer, got ${String(value)}`,
        });
      }
    }
  }

  // The resolved configuration is optional (Gap 22): indexes written before the
  // field existed must still parse. When present it is validated, because a
  // half-populated reproduction recipe is worse than none.
  if (metadata.configuration !== undefined) {
    const configuration = metadata.configuration as unknown;
    if (!isRecord(configuration)) {
      return err({ code: "MALFORMED_FILE", file: "metadata.json", detail: "configuration is not an object" });
    }
    const assessment = configuration["assessment"];
    const hierarchy = configuration["hierarchy"];
    const coefficients = configuration["weightCoefficients"];
    if (!isRecord(assessment) || !isRecord(hierarchy) || !isRecord(coefficients)) {
      return err({
        code: "MALFORMED_FILE",
        file: "metadata.json",
        detail: "configuration must carry weightCoefficients, assessment and hierarchy objects",
      });
    }
    const numeric: ReadonlyArray<readonly [string, unknown]> = [
      ["structuralQualityBoundary", configuration["structuralQualityBoundary"]],
      ["communityDetectionSeed", configuration["communityDetectionSeed"]],
      ["assessment.cohesionSquashConstant", assessment["cohesionSquashConstant"]],
      ["assessment.degenerateScore", assessment["degenerateScore"]],
      ["hierarchy.maxGroupSize", hierarchy["maxGroupSize"]],
      ["hierarchy.minPartitionThreshold", hierarchy["minPartitionThreshold"]],
    ];
    for (const [field, value] of numeric) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return err({
          code: "MALFORMED_FILE",
          file: "metadata.json",
          detail: `configuration.${field} must be a finite number`,
        });
      }
    }
    if (typeof assessment["computeModularity"] !== "boolean") {
      return err({
        code: "MALFORMED_FILE",
        file: "metadata.json",
        detail: "configuration.assessment.computeModularity must be a boolean",
      });
    }
  }

  // Count invariants across the file set (Gap 10). Each file was individually
  // well-formed even when a partial write left old and new files side by side,
  // so the mixture was only ever detectable by cross-checking the counts one
  // file states against the hierarchy another file describes.
  const totalEdges = leafEdges.length + crossGroupEdges.length;
  const countChecks: ReadonlyArray<readonly [string, string, number, number]> = [
    ["repository.json", "nodeCount", repositoryDoc.nodeCount as number, nodes.size],
    ["repository.json", "edgeCount", repositoryDoc.edgeCount as number, totalEdges],
    ["repository.json", "hierarchyDepth", repositoryDoc.hierarchyDepth, depthOf(nodes)],
    ["metadata.json", "nodeCount", metadata.nodeCount, nodes.size],
    ["metadata.json", "edgeCount", metadata.edgeCount, totalEdges],
    ["metadata.json", "hierarchyDepth", metadata.hierarchyDepth, repositoryDoc.hierarchyDepth],
    ["metadata.json", "totalCrossGroupEdges", metadata.totalCrossGroupEdges, crossGroupEdges.length],
  ];
  for (const [file, field, stated, actual] of countChecks) {
    if (stated !== actual) {
      return err({
        code: "MALFORMED_FILE",
        file,
        detail: `${field} is ${stated} but the parsed index has ${actual} — the file set is inconsistent`,
      });
    }
  }

  return ok({
    hierarchy: {
      repositoryId: hierarchyDoc.repositoryId,
      nodes,
      leafAttributes,
      leafEdges,
      crossGroupEdges,
      depth: repositoryDoc.hierarchyDepth,
    },
    metadata,
  });
}
