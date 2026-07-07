/**
 * Cross-file stitching and frequency signals (design: "Stitcher (R5, R6)").
 *
 * The stitcher is where per-file ASTs become a single connected dependency
 * graph. It takes the fully extracted node set, the flat list of unresolved
 * {@link RawReference}s the extractor collected, and the {@link SymbolTable}
 * built from the nodes, and produces the graph's directed
 * {@link DependencyEdge}s.
 *
 * ## What Task 7.1 does (this file's current scope)
 *
 * For every {@link RawReference} the stitcher:
 *
 * 1. **Resolves** `targetName` through the {@link SymbolTable}. A name whose
 *    declaring entity is not part of the project resolves to nothing and the
 *    reference is dropped — no edge and no synthetic external node is created
 *    (R5.4).
 * 2. **Maps endpoints to file/class scope.** An edge may only connect nodes of
 *    kind `file` or `class`; any candidate edge with a `function` endpoint (for
 *    example a resolved `import static com.example.Utils.helper;`) is dropped
 *    (R5.2).
 * 3. **Guards endpoints.** A candidate whose source or target node is absent
 *    from the node set is dropped, so every emitted edge endpoint references an
 *    existing node (R5.5). A reference that resolves a node to itself (including
 *    intra-file references) produces no self-edge (R5.6).
 * 4. **De-duplicates by `(source, target)`.** Multiple resolved references
 *    between the same ordered pair collapse into exactly one edge rather than
 *    parallel duplicates (R5.3).
 *
 * ## Frequency signals (R6)
 *
 * Edges are held in a `(source, target)`-keyed accumulator carrying **exactly**
 * the three contract frequency signals — no more, no fewer (R6.1):
 *
 * - `importFrequency` counts the resolved import-based references for the pair,
 *   each resolved reference counted exactly once (R6.2). It is seeded at `0` and
 *   only ever incremented by `1`, so it is always a finite non-negative integer.
 * - `methodCallFrequency` (R6.3) and `sharedTypeCount` (R6.4) are recorded for
 *   **every** edge and held at the Phase-1 value `0`, because cross-entity
 *   method-call and shared-type resolution are deferred. They are never left
 *   absent or undefined (R6.6).
 * - Every signal is therefore a finite, non-negative integer, never negative,
 *   fractional, `NaN`, or `Infinity` (R6.5), and a signal with no contributing
 *   reference is exactly `0` (R6.6).
 *
 * Recomputing on identical input yields identical signal values (R6.7): the
 * accumulator seeds are constant and the only mutation (`+= 1`) is commutative,
 * so both the values and the edge set are independent of processing order.
 *
 * ## Determinism
 *
 * The edge set is a pure function of the node set and the symbol table, both of
 * which are already canonical. Because de-duplication is keyed by
 * `(source, target)` and every accumulator update is commutative (increment),
 * the resulting edge set is independent of the order references are processed
 * (R5.7, R6.7). Callers that need canonical *ordering* of the returned array use
 * `canonical.ts`; this module returns edges in first-seen key order, which the
 * serializer re-sorts.
 *
 * This module is pure and side-effect free.
 */

import type { DependencyEdge, GraphNode, NodeId } from "@repohive/shared";
import type { RawReference } from "./types.js";
import type { SymbolTable } from "./symbol-table.js";

/**
 * Separator used to key an edge by its ordered `(source, target)` pair. The
 * NUL character never appears in a node id, so `source + SEP + target` is an
 * unambiguous, collision-free key.
 */
const EDGE_KEY_SEPARATOR = "\u0000";

/**
 * Mutable per-edge accumulator keyed by `(source, target)` (design: "Stitcher
 * (R5, R6)"). Holds exactly the three contract frequency signals (R6.1) and is
 * converted verbatim into a {@link DependencyEdge} on output.
 */
interface EdgeAccumulator {
  source: NodeId;
  target: NodeId;
  importFrequency: number;
  methodCallFrequency: number;
  sharedTypeCount: number;
}

/** Resolves cross-file references into de-duplicated directed edges (design: R5, R6). */
export interface Stitcher {
  /**
   * Resolve `references` against `symbols` into the de-duplicated directed
   * edge set of the dependency graph.
   *
   * @param nodes the fully extracted node set; used to validate endpoints and
   *   to reject `function`-endpoint edges (R5.2, R5.5).
   * @param references the flat list of unresolved references from extraction.
   * @param symbols the symbol table built from `nodes` (R4).
   * @returns the de-duplicated {@link DependencyEdge}s (unordered; the
   *   serializer applies canonical ordering).
   */
  stitch(
    nodes: GraphNode[],
    references: RawReference[],
    symbols: SymbolTable,
  ): DependencyEdge[];
}

/** Build the edge key for an ordered `(source, target)` pair. */
function edgeKey(source: NodeId, target: NodeId): string {
  return source + EDGE_KEY_SEPARATOR + target;
}

/**
 * Resolve a single {@link RawReference} to a valid, non-self, file/class-scoped
 * `(source, target)` pair, or `null` when the reference contributes no edge.
 *
 * A reference contributes nothing when its target name is unresolved (R5.4),
 * either endpoint is absent from the node set (R5.5), either endpoint is a
 * `function` node (R5.2), or the endpoints are identical (self-edge, R5.6).
 */
function resolveEndpoints(
  reference: RawReference,
  nodesById: Map<NodeId, GraphNode>,
  symbols: SymbolTable,
): { source: NodeId; target: NodeId } | null {
  const source = reference.fromNodeId;
  const sourceNode = nodesById.get(source);
  // Endpoint must reference an existing node (R5.5).
  if (sourceNode === undefined) {
    return null;
  }

  // Resolve the referenced name; an out-of-project name yields no edge (R5.4).
  const target = symbols.lookup(reference.targetName);
  if (target === null) {
    return null;
  }
  const targetNode = nodesById.get(target);
  // Defensive: symbol-table ids are drawn from the node set, but guard anyway
  // so no dangling endpoint can ever be emitted (R5.5).
  if (targetNode === undefined) {
    return null;
  }

  // Edges connect only file/class-scoped nodes; drop any function endpoint
  // (e.g. a resolved static-member import) (R5.2).
  if (sourceNode.kind === "function" || targetNode.kind === "function") {
    return null;
  }

  // No self-referential edges, including intra-file references that resolve to
  // the same node (R5.6).
  if (source === target) {
    return null;
  }

  return { source, target };
}

/**
 * Resolve `references` into the de-duplicated directed edge set (R5, and the
 * `importFrequency` accumulation seam for R6).
 *
 * @see Stitcher.stitch
 */
export function stitch(
  nodes: GraphNode[],
  references: RawReference[],
  symbols: SymbolTable,
): DependencyEdge[] {
  const nodesById = new Map<NodeId, GraphNode>();
  for (const node of nodes) {
    nodesById.set(node.id, node);
  }

  // De-duplication + frequency accumulation keyed by (source, target): parallel
  // references between the same ordered pair collapse into one edge (R5.3).
  const accumulators = new Map<string, EdgeAccumulator>();

  for (const reference of references) {
    const endpoints = resolveEndpoints(reference, nodesById, symbols);
    if (endpoints === null) {
      continue;
    }

    const key = edgeKey(endpoints.source, endpoints.target);
    let accumulator = accumulators.get(key);
    if (accumulator === undefined) {
      accumulator = {
        source: endpoints.source,
        target: endpoints.target,
        // Every signal is seeded to exactly 0 so an edge with no contributing
        // reference for a signal carries 0 rather than an absent/undefined
        // value (R6.6). importFrequency accumulates below; methodCallFrequency
        // and sharedTypeCount stay 0 in Phase 1 (R6.3, R6.4).
        importFrequency: 0,
        methodCallFrequency: 0,
        sharedTypeCount: 0,
      };
      accumulators.set(key, accumulator);
    }

    // Count each resolved import reference exactly once toward the collapsed
    // edge (R6.2). Non-import kinds do not contribute to importFrequency.
    if (reference.kind === "import") {
      accumulator.importFrequency += 1;
    }
  }

  return [...accumulators.values()].map((accumulator) => ({
    source: accumulator.source,
    target: accumulator.target,
    importFrequency: accumulator.importFrequency,
    methodCallFrequency: accumulator.methodCallFrequency,
    sharedTypeCount: accumulator.sharedTypeCount,
  }));
}

/**
 * Create a {@link Stitcher}.
 *
 * The stitcher is stateless; each {@link Stitcher.stitch} call produces an
 * independent edge set.
 */
export function createStitcher(): Stitcher {
  return { stitch };
}
