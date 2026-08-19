/**
 * Hierarchy_Builder (Requirements 6, 7, 8, 11): assemble the per-Region group
 * results into the multi-level hierarchy, enforce sizing via deterministic
 * balanced partitioning, derive content-addressed identifiers, and preserve
 * every dependency (leaf edges verbatim + aggregated Cross_Group_Edges).
 *
 * Base shape: Repository (level 0) → one Level-1 Group_Node per Primary_Region
 * → the Region's construction groups as Level-2 Group_Nodes → File nodes →
 * class/function nodes under their defining File (6.2, 6.3). Sizing is then
 * enforced bottom-up:
 * - an oversized Level-2 group splits into `b = ceil(n / maxGroupSize)`
 *   sibling Level-2 groups (fewest possible; sizes differ by at most one);
 * - an oversized Level-1 group splits the same way into sibling Level-1
 *   groups;
 * - an oversized Repository is handled by wrapping its children into
 *   intermediate Group_Node levels until the bound holds (11.2), so hierarchy
 *   depth derives from maxGroupSize and the file count.
 *
 * All slicing operates on canonically sorted child ids, and every Group_Node
 * id is a content hash of its membership, so the result is deterministic and
 * input-order independent (7.x).
 */

import type { DependencyEdge, GraphNode, NodeId } from "@repohive/shared";
import { compareIds, sortIds } from "./canonical.js";
import { err, ok, type Result } from "./errors.js";
import { groupIdOf, repositoryIdOf } from "./group-id.js";
import type {
  ConstructionResult,
  CrossGroupEdge,
  Hierarchy,
  HierarchyConfig,
  HierarchyNode,
  WeightedModel,
} from "./types.js";

export const DEFAULT_HIERARCHY_CONFIG: HierarchyConfig = {
  maxGroupSize: 20,
  minPartitionThreshold: 2,
};

export function validateHierarchyConfig(config: HierarchyConfig): Result<HierarchyConfig> {
  if (!Number.isInteger(config.maxGroupSize) || config.maxGroupSize < 2 || config.maxGroupSize > 50) {
    return err({
      code: "INVALID_CONFIG",
      detail: `maxGroupSize must be an integer between 2 and 50 inclusive, got ${config.maxGroupSize}`,
    });
  }
  if (
    !Number.isInteger(config.minPartitionThreshold) ||
    config.minPartitionThreshold < 2 ||
    config.minPartitionThreshold > config.maxGroupSize
  ) {
    return err({
      code: "INVALID_CONFIG",
      detail: `minPartitionThreshold must be an integer between 2 and maxGroupSize (${config.maxGroupSize}) inclusive, got ${config.minPartitionThreshold}`,
    });
  }
  return ok(config);
}

export function buildHierarchy(
  construction: ConstructionResult,
  model: WeightedModel,
  config: HierarchyConfig = DEFAULT_HIERARCHY_CONFIG
): Result<Hierarchy> {
  const validated = validateHierarchyConfig(config);
  if (!validated.ok) {
    return validated;
  }
  const { maxGroupSize, minPartitionThreshold } = config;

  const nodes = new Map<NodeId, HierarchyNode>();
  const leafAttributes = new Map<NodeId, GraphNode>();

  // --- Leaf layer: files own their declared classes/functions (6.3). -------
  const childrenOfFile = new Map<NodeId, NodeId[]>();
  for (const node of model.nodes) {
    leafAttributes.set(node.id, node);
    if (
      node.kind !== "file" &&
      node.definedInFile !== undefined &&
      model.nodesById.get(node.definedInFile)?.kind === "file"
    ) {
      const list = childrenOfFile.get(node.definedInFile);
      if (list) {
        list.push(node.id);
      } else {
        childrenOfFile.set(node.definedInFile, [node.id]);
      }
    }
  }

  // --- Level-2 groups: the construction results, size-partitioned. ---------
  // Regions iterate in canonical order (construction preserves it).
  const level2IdsOfRegion = new Map<string, NodeId[]>();
  for (const [regionId, groups] of construction.regionGroups) {
    const level2Ids: NodeId[] = [];
    for (const group of groups) {
      for (const slice of partitionChildren(group.fileIds, maxGroupSize, minPartitionThreshold)) {
        const id = groupIdOf(slice);
        addGroupNode(nodes, id, slice);
        level2Ids.push(id);
      }
    }
    level2IdsOfRegion.set(regionId, level2Ids);
  }

  // --- Level-1 groups: one per Primary_Region, size-partitioned. -----------
  let level1Ids: NodeId[] = [];
  for (const [, level2Ids] of level2IdsOfRegion) {
    for (const slice of partitionChildren(level2Ids, maxGroupSize, minPartitionThreshold)) {
      const id = groupIdOf(slice);
      addGroupNode(nodes, id, slice);
      level1Ids.push(id);
    }
  }

  // --- Repository: wrap into intermediate levels while oversized (11.2). ---
  let repositoryChildren = sortIds(level1Ids);
  while (repositoryChildren.length > maxGroupSize) {
    const wrapped: NodeId[] = [];
    for (const slice of partitionChildren(repositoryChildren, maxGroupSize, minPartitionThreshold)) {
      const id = groupIdOf(slice);
      addGroupNode(nodes, id, slice);
      wrapped.push(id);
    }
    repositoryChildren = sortIds(wrapped);
  }
  const repositoryId = repositoryIdOf(repositoryChildren);
  nodes.set(repositoryId, {
    id: repositoryId,
    kind: "repository",
    level: 0,
    parentId: null,
    childIds: repositoryChildren,
  });

  // --- Attach leaves: files under their Level-2 group, members under files. -
  for (const [, groupNode] of nodes) {
    if (groupNode.kind !== "group") {
      continue;
    }
    for (const childId of groupNode.childIds) {
      if (!nodes.has(childId)) {
        const attr = leafAttributes.get(childId);
        nodes.set(childId, {
          id: childId,
          kind: attr?.kind ?? "file",
          level: -1,
          parentId: groupNode.id,
          childIds: sortIds(childrenOfFile.get(childId) ?? []),
        });
      }
    }
  }
  for (const [fileId, memberIds] of childrenOfFile) {
    for (const memberId of memberIds) {
      if (!nodes.has(memberId)) {
        const attr = leafAttributes.get(memberId);
        nodes.set(memberId, {
          id: memberId,
          kind: attr?.kind ?? "function",
          level: -1,
          parentId: fileId,
          childIds: [],
        });
      }
    }
    const fileNode = nodes.get(fileId);
    if (!fileNode) {
      // Defensive: a file with members but no region (cannot happen when the
      // Primary_Region partition is total over File nodes).
      continue;
    }
  }

  // --- Wire parent pointers of group children + levels via BFS. ------------
  for (const [, node] of nodes) {
    for (const childId of node.childIds) {
      const child = nodes.get(childId);
      if (child) {
        child.parentId = node.id;
      }
    }
  }
  let depth = 0;
  const queue: Array<{ id: NodeId; level: number }> = [{ id: repositoryId, level: 0 }];
  while (queue.length > 0) {
    const { id, level } = queue.shift()!;
    const node = nodes.get(id);
    if (!node) {
      continue;
    }
    node.level = level;
    depth = Math.max(depth, level);
    for (const childId of node.childIds) {
      queue.push({ id: childId, level: level + 1 });
    }
  }

  // --- Dependency preservation (8.1) + Cross_Group_Edges (8.2–8.4). --------
  const leafEdges = model.weightedEdges;
  const crossGroupEdges = aggregateCrossGroupEdges(leafEdges, nodes);

  return ok({
    repositoryId,
    nodes,
    leafAttributes,
    leafEdges,
    crossGroupEdges,
    depth,
  });
}

function addGroupNode(nodes: Map<NodeId, HierarchyNode>, id: NodeId, childIds: readonly NodeId[]): void {
  nodes.set(id, {
    id,
    kind: "group",
    level: -1,
    parentId: null,
    childIds: sortIds(childIds),
  });
}

/**
 * Balanced partitioning heuristic (design 6.7, 11.1, 11.2):
 * b = ceil(n / maxGroupSize) subgroups — the provable minimum — filled from
 * the canonically sorted child list so that the first (n mod b) subgroups get
 * ceil(n / b) children and the rest get floor(n / b); sizes differ by at most
 * one. Groups under the bound (or below the partition threshold) pass through
 * as a single slice.
 */
export function partitionChildren(
  childIds: readonly NodeId[],
  maxGroupSize: number,
  minPartitionThreshold: number
): NodeId[][] {
  const sorted = sortIds(childIds);
  const n = sorted.length;
  if (n <= maxGroupSize || n < minPartitionThreshold) {
    return [sorted];
  }
  const b = Math.ceil(n / maxGroupSize);
  const base = Math.floor(n / b);
  const remainder = n % b;
  const slices: NodeId[][] = [];
  let offset = 0;
  for (let i = 0; i < b; i++) {
    const size = i < remainder ? base + 1 : base;
    slices.push(sorted.slice(offset, offset + size));
    offset += size;
  }
  return slices;
}

/**
 * Aggregate Cross_Group_Edges: for every leaf edge whose endpoints' ancestor
 * chains diverge, represent the relationship at each group level where the
 * ancestors differ; the concrete edge between the two distinct immediate
 * parents arises at the lowest (deepest) such level (8.2). Leaves sharing an
 * immediate parent contribute nothing at that level (8.3). Weights sum the
 * underlying leaf strengths per (source group, target group) pair (8.4).
 */
export function aggregateCrossGroupEdges(
  leafEdges: ReadonlyArray<DependencyEdge & { strength: number }>,
  nodes: Map<NodeId, HierarchyNode>
): CrossGroupEdge[] {
  const aggregated = new Map<string, CrossGroupEdge>();

  for (const edge of leafEdges) {
    const sourcePath = ancestorPath(edge.source, nodes);
    const targetPath = ancestorPath(edge.target, nodes);
    if (sourcePath === null || targetPath === null) {
      continue;
    }
    const levels = Math.min(sourcePath.length, targetPath.length);
    for (let i = 0; i < levels; i++) {
      const sourceAncestor = sourcePath[i]!;
      const targetAncestor = targetPath[i]!;
      if (sourceAncestor === targetAncestor) {
        continue;
      }
      const sourceNode = nodes.get(sourceAncestor);
      const targetNode = nodes.get(targetAncestor);
      // Cross_Group_Edges connect Group_Nodes only.
      if (sourceNode?.kind !== "group" || targetNode?.kind !== "group") {
        break;
      }
      const key = JSON.stringify([sourceAncestor, targetAncestor]);
      const existing = aggregated.get(key);
      if (existing) {
        existing.weight += edge.strength;
      } else {
        aggregated.set(key, {
          source: sourceAncestor,
          target: targetAncestor,
          level: sourceNode.level,
          weight: edge.strength,
        });
      }
    }
  }

  return [...aggregated.values()].sort(
    (a, b) => compareIds(a.source, b.source) || compareIds(a.target, b.target)
  );
}

/** Root→node chain of ids, or null when the node is not in the hierarchy. */
function ancestorPath(id: NodeId, nodes: Map<NodeId, HierarchyNode>): NodeId[] | null {
  const node = nodes.get(id);
  if (!node) {
    return null;
  }
  const path: NodeId[] = [];
  let current: HierarchyNode | undefined = node;
  while (current) {
    path.push(current.id);
    current = current.parentId === null ? undefined : nodes.get(current.parentId);
  }
  return path.reverse();
}
