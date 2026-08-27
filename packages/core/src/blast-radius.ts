/**
 * Blast_Radius_Analyzer (Requirement 10): given a modified node, return every
 * node whose dependency path reaches it (reverse reachability over dependency
 * edges, dependent → dependency direction), plus the Group_Nodes containing
 * any impacted leaf.
 *
 * Cycle-safe: a visited set guarantees each node is visited at most once
 * (10.6, 10.7). Deterministic: results are sorted canonically, and repeated
 * queries on an unchanged Hierarchy return identical sets (10.8). Error
 * paths: empty/null id → EMPTY_NODE_ID (10.4); unknown id → NODE_NOT_FOUND
 * with the Hierarchy unchanged (10.3).
 */

import type { NodeId } from "@repohive/shared";
import { sortIds } from "./canonical.js";
import { err, ok, type Result } from "./errors.js";
import type { Hierarchy } from "./types.js";

export interface BlastRadius {
  /** The impacted nodes (the target + everything that reaches it). */
  nodes: NodeId[];
  /** Group_Nodes containing any impacted leaf. */
  groupNodes: NodeId[];
}

export function analyzeBlastRadius(hierarchy: Hierarchy, nodeId: NodeId | null | undefined): Result<BlastRadius> {
  if (nodeId === null || nodeId === undefined || nodeId === "") {
    return err({ code: "EMPTY_NODE_ID" });
  }
  if (!hierarchy.nodes.has(nodeId)) {
    return err({ code: "NODE_NOT_FOUND", nodeId });
  }

  // Reverse adjacency: target → sources (the dependents of each node).
  const dependentsOf = new Map<NodeId, NodeId[]>();
  for (const edge of hierarchy.leafEdges) {
    const list = dependentsOf.get(edge.target);
    if (list) {
      list.push(edge.source);
    } else {
      dependentsOf.set(edge.target, [edge.source]);
    }
  }

  const visited = new Set<NodeId>([nodeId]);
  const queue: NodeId[] = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of dependentsOf.get(current) ?? []) {
      if (!visited.has(dependent)) {
        visited.add(dependent);
        queue.push(dependent);
      }
    }
  }

  const groupNodes = new Set<NodeId>();
  for (const impacted of visited) {
    // The ancestor climb needs its own visited set. The dependency-edge
    // traversal above has one, but containment was assumed acyclic — so a
    // Hierarchy whose parentId links form a cycle sent this loop round forever
    // (Gap 11). `analyzeBlastRadius` is public API over a plain Hierarchy value,
    // so it cannot assume its input came from `buildHierarchy`.
    //
    // Breaking rather than erroring is deliberate: Req 10.3/10.4 enumerate only
    // "not found" and "empty id" failures, so a new error code for malformed
    // containment would exceed the spec — while terminating is exactly what
    // Req 10.7 demands.
    const climbed = new Set<NodeId>([impacted]);
    let node = hierarchy.nodes.get(impacted);
    while (node && node.parentId !== null) {
      if (climbed.has(node.parentId)) {
        break;
      }
      climbed.add(node.parentId);
      const parent = hierarchy.nodes.get(node.parentId);
      if (parent?.kind === "group") {
        groupNodes.add(parent.id);
      }
      node = parent;
    }
  }

  return ok({
    nodes: sortIds([...visited]),
    groupNodes: sortIds([...groupNodes]),
  });
}
