/**
 * Graph_Ingestor (Requirement 1): validate atomically, load all nodes/edges,
 * reject on any structural defect with no partial load.
 *
 * Validation order (design): null/absent input (1.6) → zero nodes (1.3) →
 * element field validity (1.7) → duplicate node id (1.5) → dangling edge
 * endpoint (1.2). On success the model contains exactly the input node and
 * edge sets (1.1, 1.4), held in canonical order.
 *
 * `graph.json` is untrusted disk input — the sanctioned adaptive demo runs on a
 * hand-authored fixture, so malformed input is a real path, not a hypothetical.
 * The field-validity walk runs before the structural checks so the order in
 * which defects are reported stays well defined.
 */

import { MultiDirectedGraph } from "graphology";
import type { GraphNode, RawDependencyGraph } from "@repohive/shared";
import { compareDependencyEdges, compareIds } from "./canonical.js";
import { err, ok, type GroupingError, type Result } from "./errors.js";
import type { DependencyModel } from "./types.js";

/** The node kinds the shared contract defines. */
const KINDS = new Set<string>(["file", "class", "function", "group", "repository"]);

/** The three frequency signals every edge carries (contract: DependencyEdge). */
const SIGNALS = ["importFrequency", "methodCallFrequency", "sharedTypeCount"] as const;

/** The contract's "Non-negative integer" written as a predicate. */
function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Check every element's field types against the shared contract.
 *
 * The contract's doc comments already assert these invariants; nothing enforced
 * them, so a string `"5"` silently became strength 5, a fractional `2.5` was
 * accepted despite "integer", and an empty-string id or unknown `kind` passed
 * straight through. Returns the first violation, or `null` when the graph
 * conforms. Rejecting rather than repairing is deliberate: coercion would
 * rewrite the evidence a research artifact rests on, and cannot resolve an
 * ambiguous `"abc"` without inventing data.
 */
function validateRawGraph(input: RawDependencyGraph): GroupingError | null {
  for (const node of input.nodes as readonly (GraphNode | null | undefined)[]) {
    if (node === null || node === undefined || typeof node !== "object") {
      return { code: "MALFORMED_NODE", nodeId: "", detail: "node entry is not an object" };
    }
    if (typeof node.id !== "string" || node.id.length === 0) {
      return {
        code: "MALFORMED_NODE",
        nodeId: String(node.id),
        detail: "id must be a non-empty string",
      };
    }
    if (!KINDS.has(node.kind)) {
      return {
        code: "MALFORMED_NODE",
        nodeId: node.id,
        detail: `unknown kind "${String(node.kind)}"`,
      };
    }
    if (typeof node.directoryPath !== "string") {
      return {
        code: "MALFORMED_NODE",
        nodeId: node.id,
        detail: "directoryPath must be a string",
      };
    }
    if (node.packagePath !== undefined && typeof node.packagePath !== "string") {
      return {
        code: "MALFORMED_NODE",
        nodeId: node.id,
        detail: "packagePath must be a string when present",
      };
    }
    // Field-omission semantics: a `file` node has no defining file. The
    // class/function side of this invariant is checked by the gate further down.
    if (node.kind === "file" && node.definedInFile !== undefined) {
      return {
        code: "MALFORMED_NODE",
        nodeId: node.id,
        detail: "file nodes must omit definedInFile",
      };
    }
  }

  for (const edge of input.edges as readonly (RawDependencyGraph["edges"][number] | null | undefined)[]) {
    if (edge === null || edge === undefined || typeof edge !== "object") {
      return { code: "MALFORMED_EDGE", detail: "edge entry is not an object" };
    }
    if (typeof edge.source !== "string" || typeof edge.target !== "string") {
      return { code: "MALFORMED_EDGE", detail: "source and target must be strings" };
    }
    for (const field of SIGNALS) {
      if (!isNonNegativeInteger(edge[field])) {
        return {
          code: "MALFORMED_EDGE",
          source: edge.source,
          target: edge.target,
          detail: `${field} must be a non-negative integer, got ${JSON.stringify(edge[field]) ?? String(edge[field])}`,
        };
      }
    }
    if (
      edge.strength !== undefined &&
      !(typeof edge.strength === "number" && Number.isFinite(edge.strength) && edge.strength >= 0)
    ) {
      return {
        code: "MALFORMED_EDGE",
        source: edge.source,
        target: edge.target,
        detail: "strength must be a finite non-negative number when present",
      };
    }
  }

  return null;
}

export function ingest(input: RawDependencyGraph | null | undefined): Result<DependencyModel> {
  if (input === null || input === undefined || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    return err({ code: "NO_GRAPH" });
  }
  if (input.nodes.length === 0) {
    return err({ code: "EMPTY_GRAPH" });
  }

  const malformed = validateRawGraph(input);
  if (malformed !== null) {
    return err(malformed);
  }

  const nodesById = new Map<string, GraphNode>();
  for (const node of [...input.nodes].sort((a, b) => compareIds(a.id, b.id))) {
    if (nodesById.has(node.id)) {
      return err({ code: "DUPLICATE_NODE", nodeId: node.id });
    }
    nodesById.set(node.id, node);
  }

  // Full-content comparator: parallel (source, target) edges get a canonical
  // order too, so downstream accumulation never depends on input position.
  const edges = [...input.edges].sort(compareDependencyEdges);
  for (const edge of edges) {
    if (!nodesById.has(edge.source)) {
      return err({ code: "DANGLING_EDGE", nodeId: edge.source });
    }
    if (!nodesById.has(edge.target)) {
      return err({ code: "DANGLING_EDGE", nodeId: edge.target });
    }
  }

  // Contract invariant (shared contract.ts): class/function nodes declare the
  // `file` node they are defined in. Without this gate, contract-violating
  // input silently drops nodes from the hierarchy or crashes the modularity
  // projection downstream.
  for (const node of nodesById.values()) {
    if (node.kind !== "class" && node.kind !== "function") {
      continue;
    }
    if (node.definedInFile === undefined) {
      return err({
        code: "INVALID_DEFINED_IN_FILE",
        nodeId: node.id,
        detail: "class/function nodes must declare definedInFile",
      });
    }
    const owner = nodesById.get(node.definedInFile);
    if (owner === undefined) {
      return err({
        code: "INVALID_DEFINED_IN_FILE",
        nodeId: node.id,
        detail: `definedInFile references a missing node: ${node.definedInFile}`,
      });
    }
    if (owner.kind !== "file") {
      return err({
        code: "INVALID_DEFINED_IN_FILE",
        nodeId: node.id,
        detail: `definedInFile must reference a file node, got kind "${owner.kind}": ${node.definedInFile}`,
      });
    }
  }

  // All validation passed — build the model (no partial load before this point).
  const nodes = [...nodesById.values()];
  const graph = new MultiDirectedGraph({ allowSelfLoops: true });
  for (const node of nodes) {
    graph.addNode(node.id, { kind: node.kind });
  }
  for (const edge of edges) {
    graph.addEdge(edge.source, edge.target);
  }

  return ok({ nodes, nodesById, edges, graph });
}
