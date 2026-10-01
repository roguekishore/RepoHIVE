/**
 * Index_Parser: read an Index_File_Set (compact format, see
 * `index-format.ts`) back into the in-memory model with full fidelity — same node set, edge set, per-Region
 * decisions, and depth (9.5). Atomic failure: ALL missing member files are
 * reported in one MISSING_FILES error (9.6); malformed JSON or a missing
 * required field is reported as MALFORMED_FILE naming the file (9.7); no
 * partial Hierarchy is ever returned. A file whose `formatVersion` is missing or
 * not the one this reader supports is UNSUPPORTED_FORMAT_VERSION; there is no
 * reader for any other version.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GraphNode, NodeId } from "@repohive/shared";
import { compareIds } from "./canonical.js";
import { err, ok, type Result } from "./errors.js";
import { ABSENT, INDEX_FORMAT_VERSION, NODE_KIND_CODES } from "./index-format.js";
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

/** An integer that is either {@link ABSENT} or a position in `[0, bound)`. */
function isOptionalRef(value: unknown, bound: number): value is number {
  return Number.isInteger(value) && ((value as number) === ABSENT || ((value as number) >= 0 && (value as number) < bound));
}

/** An integer position in `[0, bound)`. */
function isRef(value: unknown, bound: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < bound;
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

  // Every file states the format it was written in. Checked before anything
  // else is read from them, so a file from another format is reported as that
  // and not as a pile of missing fields.
  for (const name of INDEX_FILE_NAMES) {
    const doc = raw[name];
    const found = isRecord(doc) ? doc["formatVersion"] : undefined;
    if (found !== INDEX_FORMAT_VERSION) {
      return err({
        code: "UNSUPPORTED_FORMAT_VERSION",
        file: name,
        found: found === undefined ? "missing" : (JSON.stringify(found) ?? String(found)),
        supported: INDEX_FORMAT_VERSION,
      });
    }
  }

  // --- hierarchy.json → the tree ------------------------------------------
  const hierarchyDoc = raw["hierarchy.json"] as { root?: unknown; ids?: unknown; nodes?: unknown };
  if (!Number.isInteger(hierarchyDoc.root) || !Array.isArray(hierarchyDoc.ids) || !Array.isArray(hierarchyDoc.nodes)) {
    return err({ code: "MALFORMED_FILE", file: "hierarchy.json", detail: "missing root, ids or nodes" });
  }
  const ids = hierarchyDoc.ids as unknown[];
  const rows = hierarchyDoc.nodes as unknown[];
  if (ids.length !== rows.length) {
    return err({
      code: "MALFORMED_FILE",
      file: "hierarchy.json",
      detail: `${ids.length} ids but ${rows.length} node rows`,
    });
  }
  // The ids are the node table every other file indexes into, in canonical order:
  // strictly ascending, which also rules out a duplicate.
  for (let i = 0; i < ids.length; i++) {
    if (typeof ids[i] !== "string") {
      return err({ code: "MALFORMED_FILE", file: "hierarchy.json", detail: `id ${i} is not a string` });
    }
    if (i > 0 && compareIds(ids[i - 1] as string, ids[i] as string) >= 0) {
      return err({
        code: "MALFORMED_FILE",
        file: "hierarchy.json",
        detail: `ids are not strictly ascending at ${String(ids[i])}`,
      });
    }
  }
  if (!isRef(hierarchyDoc.root, ids.length)) {
    return err({ code: "MALFORMED_FILE", file: "hierarchy.json", detail: `root ${String(hierarchyDoc.root)} is not a node` });
  }
  const nodeIds = ids as NodeId[];
  const repositoryId = nodeIds[hierarchyDoc.root] as NodeId;
  const nodes = new Map<NodeId, HierarchyNode>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const id = nodeIds[i] as NodeId;
    if (!Array.isArray(row) || row.length !== 4) {
      return err({ code: "MALFORMED_FILE", file: "hierarchy.json", detail: `node row ${i} (${id}) is not a four-field row` });
    }
    const [kindCode, level, parent, children] = row as unknown[];
    if (
      !isRef(kindCode, NODE_KIND_CODES.length) ||
      typeof level !== "number" ||
      !Number.isInteger(level) ||
      !isOptionalRef(parent, nodeIds.length) ||
      !Array.isArray(children) ||
      !children.every((child) => isRef(child, nodeIds.length))
    ) {
      return err({
        code: "MALFORMED_FILE",
        file: "hierarchy.json",
        detail: `node row ${i} (${id}) has a missing or out-of-range field`,
      });
    }
    if (level < 0) {
      return err({
        code: "MALFORMED_FILE",
        file: "hierarchy.json",
        detail: `node ${id} has a negative level ${level}`,
      });
    }
    nodes.set(id, {
      id,
      kind: NODE_KIND_CODES[kindCode] as HierarchyNode["kind"],
      level,
      parentId: parent === ABSENT ? null : (nodeIds[parent as number] as NodeId),
      childIds: (children as number[]).map((child) => nodeIds[child] as NodeId),
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
  if (roots.length !== 1 || roots[0]!.id !== repositoryId) {
    return err({
      code: "MALFORMED_FILE",
      file: "hierarchy.json",
      detail: `expected exactly one root equal to repositoryId, found ${roots.length}`,
    });
  }

  const seen = new Set<NodeId>([repositoryId]);
  const queue: NodeId[] = [repositoryId];
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
  const nodesDoc = raw["nodes.json"] as { strings?: unknown; nodes?: unknown };
  if (!Array.isArray(nodesDoc.strings) || !Array.isArray(nodesDoc.nodes)) {
    return err({ code: "MALFORMED_FILE", file: "nodes.json", detail: "missing strings or nodes" });
  }
  const strings = nodesDoc.strings as unknown[];
  if (!strings.every((value) => typeof value === "string")) {
    return err({ code: "MALFORMED_FILE", file: "nodes.json", detail: "the string table holds a non-string" });
  }
  const attributeRows = nodesDoc.nodes as unknown[];
  if (attributeRows.length !== nodes.size) {
    return err({
      code: "MALFORMED_FILE",
      file: "nodes.json",
      detail: `node count ${attributeRows.length} does not match hierarchy.json (${nodes.size})`,
    });
  }
  const leafAttributes = new Map<NodeId, GraphNode>();
  for (let i = 0; i < attributeRows.length; i++) {
    const row = attributeRows[i];
    const id = nodeIds[i] as NodeId;
    if (!Array.isArray(row) || row.length !== 5) {
      return err({ code: "MALFORMED_FILE", file: "nodes.json", detail: `row ${i} (${id}) is not a five-field row` });
    }
    const [regionPosition, ordinal, packagePosition, directoryPosition, definedInFilePosition] = row as unknown[];
    if (
      !isOptionalRef(regionPosition, strings.length) ||
      !isOptionalRef(packagePosition, strings.length) ||
      !isOptionalRef(directoryPosition, strings.length) ||
      !isOptionalRef(definedInFilePosition, nodeIds.length) ||
      !Number.isInteger(ordinal) ||
      (ordinal as number) < ABSENT
    ) {
      return err({
        code: "MALFORMED_FILE",
        file: "nodes.json",
        detail: `row ${i} (${id}) has a missing or out-of-range field`,
      });
    }
    const node = nodes.get(id)!;

    // Region provenance is optional (Gap 12), and the two halves go together.
    if (regionPosition !== ABSENT || ordinal !== ABSENT) {
      if (regionPosition === ABSENT || ordinal === ABSENT) {
        return err({
          code: "MALFORMED_FILE",
          file: "nodes.json",
          detail: `node ${id} carries incomplete region provenance (regionId and ordinal go together)`,
        });
      }
      node.regionId = strings[regionPosition as number] as string;
      node.ordinal = ordinal as number;
    }

    if (node.kind === "file" || node.kind === "class" || node.kind === "function") {
      leafAttributes.set(id, {
        id,
        kind: node.kind,
        ...(packagePosition !== ABSENT ? { packagePath: strings[packagePosition as number] as string } : {}),
        directoryPath: directoryPosition !== ABSENT ? (strings[directoryPosition as number] as string) : "",
        ...(definedInFilePosition !== ABSENT ? { definedInFile: nodeIds[definedInFilePosition as number] as NodeId } : {}),
      });
    }
  }

  // --- edges.json -----------------------------------------------------------
  const edgesDoc = raw["edges.json"] as { leaf?: unknown; cross?: unknown };
  if (!Array.isArray(edgesDoc.leaf) || !Array.isArray(edgesDoc.cross)) {
    return err({ code: "MALFORMED_FILE", file: "edges.json", detail: "missing leaf or cross" });
  }
  const leafEdges: Hierarchy["leafEdges"] = [];
  for (const entry of edgesDoc.leaf as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 6) {
      return err({ code: "MALFORMED_FILE", file: "edges.json", detail: "leaf edge is not a six-field row" });
    }
    const [source, target, importFrequency, methodCallFrequency, sharedTypeCount, strength] = entry as unknown[];
    if (
      typeof importFrequency !== "number" ||
      typeof methodCallFrequency !== "number" ||
      typeof sharedTypeCount !== "number" ||
      typeof strength !== "number"
    ) {
      return err({ code: "MALFORMED_FILE", file: "edges.json", detail: "leaf edge missing a required field" });
    }
    if (!isRef(source, nodeIds.length) || !isRef(target, nodeIds.length)) {
      return err({
        code: "MALFORMED_FILE",
        file: "edges.json",
        detail: `leaf edge references an unknown node: ${String(source)} -> ${String(target)}`,
      });
    }
    leafEdges.push({
      source: nodeIds[source] as NodeId,
      target: nodeIds[target] as NodeId,
      importFrequency,
      methodCallFrequency,
      sharedTypeCount,
      strength,
    });
  }
  const crossGroupEdges: CrossGroupEdge[] = [];
  for (const entry of edgesDoc.cross as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 4) {
      return err({ code: "MALFORMED_FILE", file: "edges.json", detail: "cross-group edge is not a four-field row" });
    }
    const [source, target, level, weight] = entry as unknown[];
    if (typeof level !== "number" || typeof weight !== "number") {
      return err({ code: "MALFORMED_FILE", file: "edges.json", detail: "cross-group edge missing a required field" });
    }
    if (!isRef(source, nodeIds.length) || !isRef(target, nodeIds.length)) {
      return err({
        code: "MALFORMED_FILE",
        file: "edges.json",
        detail: `cross-group edge references an unknown node: ${String(source)} -> ${String(target)}`,
      });
    }
    crossGroupEdges.push({
      source: nodeIds[source] as NodeId,
      target: nodeIds[target] as NodeId,
      level,
      weight,
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
  if (repositoryDoc.repositoryId !== repositoryId) {
    return err({
      code: "MALFORMED_FILE",
      file: "repository.json",
      detail: "repositoryId does not match hierarchy.json",
    });
  }

  const metadataDoc = raw["metadata.json"];
  if (!isRecord(metadataDoc)) {
    return err({ code: "MALFORMED_FILE", file: "metadata.json", detail: "document is not an object" });
  }
  const { formatVersion: _formatVersion, ...metadataFields } = metadataDoc;
  const metadata = metadataFields as unknown as Metadata;
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
      const groupRefs = decision["groupIds"];
      if (!Array.isArray(groupRefs) || !groupRefs.every((position) => Number.isInteger(position))) {
        return err({
          code: "MALFORMED_FILE",
          file: "metadata.json",
          detail: `region decision ${String(decision["regionId"])} has a malformed groupIds array`,
        });
      }
      const resolved: NodeId[] = [];
      for (const position of groupRefs as number[]) {
        if (!isRef(position, nodeIds.length)) {
          return err({
            code: "MALFORMED_FILE",
            file: "metadata.json",
            detail: `region decision ${String(decision["regionId"])} names an unknown group (position ${position})`,
          });
        }
        resolved.push(nodeIds[position] as NodeId);
      }
      // Back to ids: the in-memory Metadata names groups by id.
      decision["groupIds"] = resolved;
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
      repositoryId: repositoryId,
      nodes,
      leafAttributes,
      leafEdges,
      crossGroupEdges,
      depth: repositoryDoc.hierarchyDepth,
    },
    metadata,
  });
}
