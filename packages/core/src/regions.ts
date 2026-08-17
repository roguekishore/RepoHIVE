/**
 * Region identification + Primary_Region assignment (Requirements 3.1, 3.2).
 *
 * Phase-1 Region strategy: each declared Java package (packagePath) is a
 * Region; File nodes with no declared package fall back to their most-specific
 * directory subtree (directoryPath). The Primary_Region precedence rule is
 * deterministic: most-specific declared package boundary containing the File
 * node, else the most-specific directory subtree; ties broken by lexicographic
 * Region identifier. Every File node gets exactly one Primary_Region, so
 * ownership is total and non-overlapping.
 *
 * Region ids are namespaced (`pkg:`/`dir:`) so a package and a directory with
 * the same name can never collide.
 */

import type { GraphNode, NodeId } from "@repohive/shared";
import { compareIds } from "./canonical.js";
import type { DependencyModel, RegionId } from "./types.js";

export interface RegionMap {
  /** Region id → File-node ids (canonical order), total over File nodes. */
  members: Map<RegionId, NodeId[]>;
  primaryRegionOf: Map<NodeId, RegionId>;
}

/** The Primary_Region of a single File node (precedence rule). */
export function primaryRegionOfFile(file: GraphNode): RegionId {
  if (file.packagePath !== undefined && file.packagePath !== "") {
    return `pkg:${file.packagePath}`;
  }
  return `dir:${file.directoryPath}`;
}

export function assignRegions(model: DependencyModel): RegionMap {
  const members = new Map<RegionId, NodeId[]>();
  const primaryRegionOf = new Map<NodeId, RegionId>();

  // model.nodes is already in canonical id order, so member lists are too.
  for (const node of model.nodes) {
    if (node.kind !== "file") {
      continue;
    }
    const regionId = primaryRegionOfFile(node);
    primaryRegionOf.set(node.id, regionId);
    const list = members.get(regionId);
    if (list) {
      list.push(node.id);
    } else {
      members.set(regionId, [node.id]);
    }
  }

  // Deterministic Region iteration order for every consumer.
  const sorted = new Map([...members.entries()].sort(([a], [b]) => compareIds(a, b)));
  return { members: sorted, primaryRegionOf };
}

/**
 * Map any node to the File node that owns it for region purposes:
 * a file maps to itself; classes/functions map to their defining file.
 * Returns null when no owning FILE can be determined (defensive; the ingestor
 * validates the definedInFile invariant, but direct component callers may
 * bypass it).
 */
export function owningFileOf(node: GraphNode, nodesById: Map<NodeId, GraphNode>): NodeId | null {
  if (node.kind === "file") {
    return node.id;
  }
  if (node.definedInFile !== undefined && nodesById.get(node.definedInFile)?.kind === "file") {
    return node.definedInFile;
  }
  return null;
}
