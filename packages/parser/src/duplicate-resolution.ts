/**
 * Duplicate-declaration resolution for the tolerant parse.
 *
 * Two files in one repository can declare the same class in the same package
 * and source root (benchmark programs, per-case test inputs, generated
 * samples). The strict path treats that as fatal, because the serializer
 * refuses a graph with a repeated node id (R3.12). A tolerant run keeps going:
 * the file that sorts first in canonical order keeps its declarations, and every
 * later file that collides with an already-kept one is dropped whole.
 *
 * Whole files, not single declarations, so a file is either entirely in the
 * graph or entirely out, as with a file that will not parse. Edges that touched
 * a dropped file's own nodes are swept by the serializer as dangling.
 *
 * Deterministic: the order depends only on the file ids, never on input order,
 * worker count or timing.
 */
import { compareCanonical, type GraphNode } from "@repohive/shared";

import { FILE_ID_PREFIX } from "./ids.js";
import { makeError, type ParseError } from "./errors.js";

export interface DuplicateResolution {
  /** The nodes to serialize: the input array itself when nothing collided. */
  nodes: GraphNode[];
  /** One `duplicate-node-id` error per dropped file, in canonical file order. */
  skipped: ParseError[];
}

function toPath(fileId: string): string {
  return fileId.startsWith(FILE_ID_PREFIX) ? fileId.slice(FILE_ID_PREFIX.length) : fileId;
}

export function resolveDuplicateDeclarations(nodes: GraphNode[]): DuplicateResolution {
  // Fast path: almost every repository has no collision, so find out with one
  // pass before grouping anything.
  const seenIds = new Set<string>();
  let collides = false;
  for (const node of nodes) {
    if (seenIds.has(node.id)) {
      collides = true;
      break;
    }
    seenIds.add(node.id);
  }
  if (!collides) {
    return { nodes, skipped: [] };
  }

  const byFile = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const fileId = node.kind === "file" ? node.id : (node.definedInFile ?? node.id);
    const group = byFile.get(fileId);
    if (group === undefined) {
      byFile.set(fileId, [node]);
    } else {
      group.push(node);
    }
  }

  const kept: GraphNode[] = [];
  const skipped: ParseError[] = [];
  const claimedBy = new Map<string, string>(); // declaration id -> file id that kept it
  const fileIds = [...byFile.keys()].sort(compareCanonical);
  for (const fileId of fileIds) {
    const group = byFile.get(fileId) as GraphNode[];
    let winner: string | undefined;
    let clash: string | undefined;
    for (const node of group) {
      if (node.kind === "file") continue;
      const owner = claimedBy.get(node.id);
      if (owner !== undefined) {
        winner = owner;
        clash = node.id;
        break;
      }
    }
    if (clash === undefined) {
      for (const node of group) {
        if (node.kind !== "file") claimedBy.set(node.id, fileId);
        kept.push(node);
      }
      continue;
    }
    const relativePath = toPath(fileId);
    skipped.push(
      makeError(
        "duplicate-node-id",
        `Skipped: declares "${clash}", already declared by ${toPath(winner as string)}, which sorts first: ${relativePath}`,
        relativePath,
      ),
    );
  }
  return { nodes: kept, skipped };
}
