/**
 * CommunityDetector abstraction + the Phase-1 seeded Louvain implementation.
 *
 * The Reconstruct_Action depends on this interface, never on Louvain directly:
 * the research contribution is Adaptive Construction, not any one detector.
 * Leiden/Infomap/label-propagation detectors can be substituted later without
 * changing any other component.
 *
 * Determinism (Req 4.7): the Louvain implementation runs with a deterministic
 * seeded PRNG over canonically (identifier-)sorted nodes/edges, then re-labels
 * the resulting communities by a content-derived key (ascending minimum member
 * id), so output is order- and run-stable.
 */

import { createRequire } from "node:module";
import { UndirectedGraph } from "graphology";
import type { LouvainOptions } from "graphology-communities-louvain";
import type { NodeId } from "@repohive/shared";
import { compareIds, sortIds } from "./canonical.js";

// graphology-communities-louvain is a CJS package with ESM-style typings;
// under NodeNext the reliable way to load it is createRequire + explicit type.
type LouvainFn = (graph: UndirectedGraph, options?: LouvainOptions) => Record<string, number>;
const require = createRequire(import.meta.url);
const louvain = require("graphology-communities-louvain") as LouvainFn;

export interface CommunitySubgraph {
  /** Node ids of the Region, canonical order not required (sorted internally). */
  nodeIds: NodeId[];
  /** Strength-weighted edges among those nodes (endpoints inside nodeIds). */
  edges: Array<{ source: NodeId; target: NodeId; strength: number }>;
}

export interface CommunityAssignment {
  /** Community label per node id, labels re-based to 0..k−1 content order. */
  communityOf: Map<NodeId, number>;
}

export interface CommunityDetector {
  detect(subgraph: CommunitySubgraph, seed: number): CommunityAssignment;
}

/** Deterministic PRNG (mulberry32) so stochastic detectors become seedable. */
export function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class LouvainCommunityDetector implements CommunityDetector {
  detect(subgraph: CommunitySubgraph, seed: number): CommunityAssignment {
    // Enforce graphology's preconditions here rather than discovering them as a
    // thrown UsageGraphError from inside the library (Fix 2 — Gap 3): a repeated
    // node id makes `addNode` throw, and an edge naming a node outside the
    // subgraph makes `addEdge` throw. Both are caller mistakes, but a throw from
    // this depth escapes the Result model entirely, so normalize instead.
    const nodeIds = sortIds([...new Set(subgraph.nodeIds)]);
    const known = new Set(nodeIds);

    // Degenerate subgraphs: Louvain needs edges to find structure. With no
    // internal edges there is no dependency signal to rebuild from, so the
    // Region stays one community (documented Phase-1 behavior; avoids
    // exploding a signal-less Region into singletons).
    const graph = new UndirectedGraph();
    for (const id of nodeIds) {
      graph.addNode(id);
    }
    for (const edge of [...subgraph.edges].sort(
      (a, b) => compareIds(a.source, b.source) || compareIds(a.target, b.target)
    )) {
      if (edge.source === edge.target) {
        continue;
      }
      // An endpoint outside the subgraph contributes no intra-Region signal.
      // Dropping it degrades gracefully: if nothing usable is left, the
      // degenerate check below returns the single-community assignment.
      if (!known.has(edge.source) || !known.has(edge.target)) {
        continue;
      }
      if (graph.hasEdge(edge.source, edge.target)) {
        graph.updateEdgeAttribute(
          edge.source,
          edge.target,
          "weight",
          (w: number | undefined) => (w ?? 0) + edge.strength
        );
      } else {
        graph.addEdge(edge.source, edge.target, { weight: edge.strength });
      }
    }

    // Also degenerate when every edge carries zero weight: modularity deltas
    // are 0/0 = NaN, no node ever moves, and every file becomes its own
    // community.  Mirror the "no dependency signal to rebuild from" rationale.
    let totalWeight = 0;
    graph.forEachEdge((_e, attrs) => {
      totalWeight += (attrs["weight"] as number) ?? 0;
    });

    if (graph.size === 0 || nodeIds.length < 2 || totalWeight <= 0) {
      return { communityOf: new Map(nodeIds.map((id) => [id, 0])) };
    }

    const raw = louvain(graph, {
      rng: seededRng(seed),
      getEdgeWeight: "weight",
    });

    return { communityOf: relabelByContent(nodeIds, raw) };
  }
}

/**
 * Re-label detector output by a content-derived key: communities are numbered
 * 0..k−1 in ascending order of their minimum member id, so labels never depend
 * on the detector's internal numbering.
 */
export function relabelByContent(
  nodeIds: readonly NodeId[],
  raw: Record<string, number>
): Map<NodeId, number> {
  const membersOf = new Map<number, NodeId[]>();
  for (const id of nodeIds) {
    const label = raw[id] ?? 0;
    const list = membersOf.get(label);
    if (list) {
      list.push(id);
    } else {
      membersOf.set(label, [id]);
    }
  }
  const communities = [...membersOf.values()].map((members) => sortIds(members));
  communities.sort((a, b) => compareIds(a[0]!, b[0]!));
  const communityOf = new Map<NodeId, number>();
  communities.forEach((members, index) => {
    for (const id of members) {
      communityOf.set(id, index);
    }
  });
  return communityOf;
}
