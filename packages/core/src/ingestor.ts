/**
 * Graph_Ingestor (Requirement 1): validate atomically, load all nodes/edges,
 * reject on any structural defect with no partial load.
 *
 * Validation order (design): null/absent input (1.6) → zero nodes (1.3) →
 * duplicate node id (1.5) → dangling edge endpoint (1.2). On success the
 * model contains exactly the input node and edge sets (1.1, 1.4), held in
 * canonical order.
 */

import { MultiDirectedGraph } from "graphology";
import type { GraphNode, RawDependencyGraph } from "@repohive/shared";
import { compareDependencyEdges, compareIds } from "./canonical.js";
import { err, ok, type Result } from "./errors.js";
import type { DependencyModel } from "./types.js";

export function ingest(input: RawDependencyGraph | null | undefined): Result<DependencyModel> {
  if (input === null || input === undefined || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    return err({ code: "NO_GRAPH" });
  }
  if (input.nodes.length === 0) {
    return err({ code: "EMPTY_GRAPH" });
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
