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
 * - `sharedTypeCount` (R6.4) counts resolved `type-use` references — field,
 *   parameter, return, `extends`/`implements`, and `new` type positions — for the
 *   pair.  Each occurrence is counted once; the count is a finite non-negative
 *   integer (R6.5, R6.6).
 * - `methodCallFrequency` (R6.3) counts resolved `method-call` references for
 *   the pair (Phase-1 optional; seeded at `0` until method-call extraction lands).
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
import type { CrossScopeAmbiguity, RawReference } from "./types.js";
import type { SymbolTable } from "./symbol-table.js";
import { deriveSourceRoot } from "./source-root.js";
import { FILE_ID_PREFIX } from "./ids.js";

/** Sink notified of each cross-source-root resolution ambiguity (Fix 24 — Gap 2). */
export type AmbiguitySink = (ambiguity: CrossScopeAmbiguity) => void;

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
    onAmbiguity?: AmbiguitySink,
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
 *
 * @param singleTypeImports  Per-file map of simple name → FQN derived from the
 *   file's single-type import declarations (e.g. `"Helper" → "com.other.Helper"`).
 *   Used by the simple-name resolution path (Gap 1c).
 * @param wildcardPackages  Per-file list of package prefixes from wildcard
 *   import declarations (e.g. `["com.other"]`), in canonical order.
 *   Used by the simple-name resolution path (Gap 1c).
 * @param referringPackage  The `packagePath` of the file that owns this
 *   reference.  Used as the same-package candidate (Gap 1c).
 */
function resolveEndpoints(
  reference: RawReference,
  nodesById: Map<NodeId, GraphNode>,
  symbols: SymbolTable,
  singleTypeImports: Map<string, string>,
  wildcardPackages: readonly string[],
  referringPackage: string,
  referringScope: string,
  referringFileId: NodeId,
  onAmbiguity: AmbiguitySink | undefined,
): { source: NodeId; target: NodeId } | null {
  const source = reference.fromNodeId;
  const sourceNode = nodesById.get(source);
  // Endpoint must reference an existing node (R5.5).
  if (sourceNode === undefined) {
    return null;
  }

  // Build the JLS-precedence candidate FQN list (Gap 1c order, unchanged): the
  // name as written first, then — for a bare simple name — the single-type
  // import, the same package, and each wildcard package in canonical order.
  const candidateFqns: string[] = [reference.targetName];
  if (!reference.targetName.includes(".")) {
    const simpleName = reference.targetName;
    // Candidate 1: single-type import (JLS §7.5.1 shadows §7.5.3).
    const importedFqn = singleTypeImports.get(simpleName);
    if (importedFqn !== undefined) {
      candidateFqns.push(importedFqn);
    }
    // Candidate 2: same package (default package: FQN is the simple name, already first).
    if (referringPackage.length > 0) {
      candidateFqns.push(`${referringPackage}.${simpleName}`);
    }
    // Candidate 3: wildcard imports, canonical order.
    for (const pkg of wildcardPackages) {
      candidateFqns.push(`${pkg}.${simpleName}`);
    }
  }

  // Resolve each candidate scope-first (Fix 24 — Gap 2): prefer a definition in
  // the referring file's own source root (Java classpath semantics), then fall
  // back across roots. One cross-root match is an unambiguous cross-module edge;
  // several matches resolve deterministically to the byte-first candidate and
  // record the ambiguity. The first candidate FQN that resolves wins, so JLS
  // precedence is preserved.
  let target: NodeId | null = null;
  for (const fqn of candidateFqns) {
    const local = symbols.lookupInScope(referringScope, fqn);
    if (local !== null) {
      target = local;
      break;
    }
    const candidates = symbols.lookupAcrossScopes(fqn);
    if (candidates.length === 1) {
      target = candidates[0]!;
      break;
    }
    if (candidates.length > 1) {
      target = candidates[0]!; // byte-first (canonical order)
      if (onAmbiguity !== undefined) {
        onAmbiguity({
          referringFile: referringFileId,
          targetFqn: fqn,
          chosenId: candidates[0]!,
          candidateIds: [...candidates],
        });
      }
      break;
    }
  }

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
  onAmbiguity?: AmbiguitySink,
): DependencyEdge[] {
  const nodesById = new Map<NodeId, GraphNode>();
  for (const node of nodes) {
    nodesById.set(node.id, node);
  }

  // -------------------------------------------------------------------------
  // Gap 1c: pre-pass — build a per-file import index so simple type names can
  // be resolved via JLS precedence (single-type import → same package → wildcard).
  //
  // Structure per file:
  //   singleTypeImports: Map<simpleName, fqn>   — "Helper" → "com.other.Helper"
  //   wildcardPackages:  string[]               — ["com.other"] (canonical order)
  //
  // Only import references are processed; type-use references carry simple names
  // that are already the resolution target, not the source of resolution context.
  // -------------------------------------------------------------------------
  type FileImportIndex = {
    singleTypeImports: Map<string, string>;
    wildcardPackages: string[];
  };
  const fileImportIndex = new Map<NodeId, FileImportIndex>();

  /** Get or create the import index entry for a file node id. */
  function indexFor(fileId: NodeId): FileImportIndex {
    let entry = fileImportIndex.get(fileId);
    if (entry === undefined) {
      entry = { singleTypeImports: new Map(), wildcardPackages: [] };
      fileImportIndex.set(fileId, entry);
    }
    return entry;
  }

  // Determine the file node id for any node id: a file node is itself; a
  // class/function node's file is determined by its definedInFile field.
  function owningFileId(nodeId: NodeId): NodeId | null {
    const node = nodesById.get(nodeId);
    if (node === undefined) return null;
    if (node.kind === "file") return nodeId;
    return node.definedInFile ?? null;
  }

  for (const ref of references) {
    if (ref.kind !== "import") continue;

    const fileId = owningFileId(ref.fromNodeId);
    if (fileId === null) continue;

    const name = ref.targetName;
    if (name.endsWith(".*")) {
      // Wildcard import: strip the ".*" to get the package prefix.
      const pkg = name.slice(0, -2);
      const idx = indexFor(fileId);
      if (!idx.wildcardPackages.includes(pkg)) {
        idx.wildcardPackages.push(pkg);
      }
    } else if (!name.includes(".")) {
      // Single-segment import (rare but legal in the default package): the
      // simple name IS the FQN.  Map it to itself.
      const idx = indexFor(fileId);
      if (!idx.singleTypeImports.has(name)) {
        idx.singleTypeImports.set(name, name);
      }
    } else {
      // Dotted single-type import: derive the simple name from the last segment.
      const lastDot = name.lastIndexOf(".");
      const simpleName = name.slice(lastDot + 1);
      const idx = indexFor(fileId);
      // First-seen wins (R4.5 mirroring): if the same simple name is imported
      // twice, keep the canonical-first one (the references are in source order;
      // a duplicate import is a Java compile error anyway).
      if (!idx.singleTypeImports.has(simpleName)) {
        idx.singleTypeImports.set(simpleName, name);
      }
    }
  }

  // Sort each file's wildcard list so candidate expansion is deterministic
  // and independent of reference processing order.
  for (const idx of fileImportIndex.values()) {
    idx.wildcardPackages.sort();
  }

  // De-duplication + frequency accumulation keyed by (source, target): parallel
  // references between the same ordered pair collapse into one edge (R5.3).
  const accumulators = new Map<string, EdgeAccumulator>();

  for (const reference of references) {
    // Resolve the referring file id and its package for the simple-name path.
    const referringFileId = owningFileId(reference.fromNodeId) ?? reference.fromNodeId;
    const referringFileNode = nodesById.get(referringFileId);
    const referringPackage = referringFileNode?.packagePath ?? "";
    // Derive the referring file's source root so resolution can prefer its own
    // classpath before reaching across roots (Fix 24 — Gap 2). Uses the same
    // helper the extractor used to scope ids, so the two never disagree.
    const referringRelPath = referringFileId.startsWith(FILE_ID_PREFIX)
      ? referringFileId.slice(FILE_ID_PREFIX.length)
      : referringFileId;
    const referringScope = deriveSourceRoot(referringRelPath, referringPackage);
    const importIdx = fileImportIndex.get(referringFileId) ?? {
      singleTypeImports: new Map<string, string>(),
      wildcardPackages: [],
    };

    const endpoints = resolveEndpoints(
      reference,
      nodesById,
      symbols,
      importIdx.singleTypeImports,
      importIdx.wildcardPackages,
      referringPackage,
      referringScope,
      referringFileId,
      onAmbiguity,
    );
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

    // Increment the appropriate frequency signal for this resolved reference.
    // The switch is total over RawReferenceKind: every arm is a commutative
    // increment, so the final signal values are independent of processing order
    // (R6.7).  The type-use and method-call arms are structurally wired here
    // (inert until those reference kinds are emitted by the extractor).
    switch (reference.kind) {
      case "import":
        // Count each resolved import reference exactly once toward the collapsed
        // edge (R6.2).
        accumulator.importFrequency += 1;
        break;
      case "type-use":
        // Count each resolved type-use reference once toward sharedTypeCount
        // (R6.4).  This is the Gap 1a activation: type-use references now
        // populate the third frequency signal rather than being silently dropped.
        accumulator.sharedTypeCount += 1;
        break;
      case "method-call":
        // methodCallFrequency will be incremented here once method-call
        // extraction lands (Gap 1b).
        break;
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
