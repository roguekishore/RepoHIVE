/**
 * Index_Serializer (Requirement 9): write the five-file Index_File_Set —
 * repository.json, hierarchy.json, nodes.json, edges.json, metadata.json —
 * via the stable stringifier so identical hierarchies serialize
 * byte-identically. A failed write is reported as WRITE_FAILED naming the
 * file.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareDependencyEdges, sortByIds, stableStringify } from "./canonical.js";
import { err, ok, type Result } from "./errors.js";
import type { Hierarchy, Metadata } from "./types.js";

export const INDEX_FILE_NAMES = [
  "repository.json",
  "hierarchy.json",
  "nodes.json",
  "edges.json",
  "metadata.json",
] as const;

export type IndexFileName = (typeof INDEX_FILE_NAMES)[number];

/** Pure projection of a Hierarchy + Metadata onto the five file payloads. */
export function indexFilePayloads(hierarchy: Hierarchy, metadata: Metadata): Record<IndexFileName, unknown> {
  const hierarchyNodes = sortByIds([...hierarchy.nodes.values()]);

  return {
    "repository.json": {
      repositoryId: hierarchy.repositoryId,
      hierarchyDepth: hierarchy.depth,
      nodeCount: hierarchy.nodes.size,
      edgeCount: hierarchy.leafEdges.length + hierarchy.crossGroupEdges.length,
    },
    "hierarchy.json": {
      repositoryId: hierarchy.repositoryId,
      nodes: hierarchyNodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        level: node.level,
        parentId: node.parentId,
        childIds: node.childIds,
      })),
    },
    "nodes.json": {
      nodes: hierarchyNodes.map((node) => {
        const attributes = hierarchy.leafAttributes.get(node.id);
        return {
          id: node.id,
          kind: node.kind,
          level: node.level,
          ...(attributes?.packagePath !== undefined ? { packagePath: attributes.packagePath } : {}),
          ...(attributes?.directoryPath !== undefined ? { directoryPath: attributes.directoryPath } : {}),
          ...(attributes?.definedInFile !== undefined ? { definedInFile: attributes.definedInFile } : {}),
        };
      }),
    },
    "edges.json": {
      leafEdges: [...hierarchy.leafEdges].sort(compareDependencyEdges).map((edge) => ({
        source: edge.source,
        target: edge.target,
        importFrequency: edge.importFrequency,
        methodCallFrequency: edge.methodCallFrequency,
        sharedTypeCount: edge.sharedTypeCount,
        strength: edge.strength,
      })),
      crossGroupEdges: hierarchy.crossGroupEdges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        level: edge.level,
        weight: edge.weight,
      })),
    },
    "metadata.json": metadata,
  };
}

export function serializeIndex(hierarchy: Hierarchy, metadata: Metadata, dir: string): Result<void> {
  const payloads = indexFilePayloads(hierarchy, metadata);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return err({ code: "WRITE_FAILED", file: dir });
  }
  for (const name of INDEX_FILE_NAMES) {
    try {
      writeFileSync(join(dir, name), stableStringify(payloads[name]), "utf8");
    } catch {
      return err({ code: "WRITE_FAILED", file: name });
    }
  }
  return ok(undefined);
}
