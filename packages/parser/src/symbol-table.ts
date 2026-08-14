/**
 * Symbol-table construction for cross-file resolution (design: "SymbolTableBuilder (R4)").
 *
 * After node extraction across all files completes, the {@link SymbolTableBuilder}
 * folds the full node set into a name → node map that the {@link Stitcher} uses
 * to resolve cross-file references into edges (R4.1). Two entity kinds are keyed:
 *
 * - **Classes** by their fully qualified name (FQN): `packagePath.simpleName`, or
 *   the simple name alone in the default package (R4.2, R4.3). The class node id
 *   already encodes exactly this FQN (`class:` + FQN, see `ids.ts`), so the key is
 *   the id with its `class:` prefix removed.
 * - **Functions** by `enclosingClassFqn.simpleName` (R4.4). The function node id
 *   encodes `func:` + enclosingClassFqn + `#name(params)`; the key drops the
 *   `func:` prefix, the `#` separator, and the parameter-type list, joining the
 *   enclosing FQN and the simple name with a single `.`. (Function keys support
 *   later cross-entity call resolution; Phase-1 import edges use class/file keys.)
 *
 * Determinism (a hard parser requirement) is guaranteed two ways:
 *
 * 1. **Collision resolution is canonical-first.** When two declarations map to the
 *    same FQN, exactly one entry is retained — the node whose id sorts first under
 *    canonical (byte-wise UTF-8) order (R4.5).
 * 2. **Build order is canonical.** Construction iterates nodes in canonical id
 *    order and never overwrites an existing key, so the resulting map is identical
 *    regardless of the order nodes were presented in or any non-deterministic
 *    ordering of the underlying data structures (R4.6).
 *
 * `lookup` returns `null` for an absent key and never throws (R4.7). This module
 * is pure and side-effect free.
 */

import type { GraphNode, NodeId } from "@repohive/shared";
import { CLASS_ID_PREFIX, FUNCTION_ID_PREFIX } from "./ids.js";
import { compareNodes } from "./canonical.js";

/** Separator between an enclosing-class FQN and a function name in a func id. */
const FUNCTION_NAME_SEPARATOR = "#";
/** Opening delimiter of a function id's parameter-type list. */
const PARAMETER_LIST_OPEN = "(";
/** Separator joining an enclosing-class FQN and a function's simple name. */
const FQN_SEPARATOR = ".";

/**
 * A read-only name → node map keyed by fully qualified name (design:
 * "SymbolTableBuilder (R4)").
 */
export interface SymbolTable {
  /**
   * Resolve a fully qualified name to the id of the node that defines it.
   *
   * @returns the resolved {@link NodeId}, or `null` when no entry exists for
   *   `fqn` (R4.7). Never throws.
   */
  lookup(fqn: string): NodeId | null;
}

/** Builds a {@link SymbolTable} from a fully extracted node set (design: R4). */
export interface SymbolTableBuilder {
  build(nodes: GraphNode[]): SymbolTable;
}

/**
 * Derive the FQN key for a `class` node: the id with its `class:` prefix
 * removed. The id already encodes `packagePath.simpleName` (or the simple name
 * alone in the default package), so no reconstruction is needed (R4.2, R4.3).
 */
function classKey(node: GraphNode): string {
  return node.id.slice(CLASS_ID_PREFIX.length);
}

/**
 * Derive the FQN key for a `function` node: `enclosingClassFqn.simpleName`
 * (R4.4). The function id is `func:` + enclosingClassFqn + `#` + name +
 * `(params)`; the enclosing FQN and the simple name are joined with a single
 * `.`, dropping the `#` separator and the parameter-type list. Returns `null`
 * for a malformed id missing the `#` separator (defensive; extractor ids always
 * contain one).
 */
function functionKey(node: GraphNode): string | null {
  const body = node.id.slice(FUNCTION_ID_PREFIX.length);
  const separatorIndex = body.indexOf(FUNCTION_NAME_SEPARATOR);
  if (separatorIndex < 0) {
    return null;
  }
  const enclosingClassFqn = body.slice(0, separatorIndex);
  const afterSeparator = body.slice(separatorIndex + 1);
  const parenIndex = afterSeparator.indexOf(PARAMETER_LIST_OPEN);
  const simpleName =
    parenIndex < 0 ? afterSeparator : afterSeparator.slice(0, parenIndex);
  return enclosingClassFqn + FQN_SEPARATOR + simpleName;
}

/**
 * Compute the FQN key for a node, or `null` when the node is not keyed (only
 * `class` and `function` nodes are keyed; `file` nodes are not).
 */
function keyFor(node: GraphNode): string | null {
  switch (node.kind) {
    case "class":
      return classKey(node);
    case "function":
      return functionKey(node);
    default:
      return null;
  }
}

/**
 * Create a {@link SymbolTableBuilder}.
 *
 * The builder is stateless; each {@link SymbolTableBuilder.build} call produces
 * an independent {@link SymbolTable}.
 */
export function createSymbolTableBuilder(): SymbolTableBuilder {
  return {
    build(nodes: GraphNode[]): SymbolTable {
      return buildSymbolTable(nodes);
    },
  };
}

/**
 * Build a {@link SymbolTable} from a fully extracted node set (R4.1).
 *
 * Nodes are sorted into canonical id order and folded left-to-right; the first
 * node seen for a given key wins, so collisions deterministically resolve to the
 * canonical-first node (R4.5) and the map is reproducible regardless of input
 * order (R4.6). Only `class` and `function` nodes are keyed.
 */
export function buildSymbolTable(nodes: GraphNode[]): SymbolTable {
  const entries = new Map<string, NodeId>();

  // Iterate in canonical id order (byte-wise UTF-8) so that "first insert wins"
  // deterministically retains the canonical-first node on collision (R4.5, R4.6).
  const ordered = [...nodes].sort(compareNodes);
  for (const node of ordered) {
    const key = keyFor(node);
    if (key === null) {
      continue;
    }
    if (!entries.has(key)) {
      entries.set(key, node.id);
    }
  }

  return {
    lookup(fqn: string): NodeId | null {
      const found = entries.get(fqn);
      return found === undefined ? null : found;
    },
  };
}
