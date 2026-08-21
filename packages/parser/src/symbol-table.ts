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
   * Resolve a fully qualified name to the id of the node that defines it,
   * canonical-first across all source roots.
   *
   * @returns the resolved {@link NodeId}, or `null` when no entry exists for
   *   `fqn` (R4.7). Never throws.
   */
  lookup(fqn: string): NodeId | null;
  /**
   * Resolve `fqn` **within a specific source-root scope** — the referring
   * file's own classpath, matching Java resolution semantics (Fix 24 — Gap 2).
   *
   * @returns the node defining `fqn` in `scope`, or `null` when none exists in
   *   that scope. Never throws.
   */
  lookupInScope(scope: string, fqn: string): NodeId | null;
  /**
   * All nodes defining `fqn` across every source root, in canonical id order
   * (Fix 24 — Gap 2). Used for the cross-scope fallback: a single element is an
   * unambiguous cross-module reference; several elements are an ambiguity the
   * caller resolves deterministically (byte-first) and records.
   *
   * @returns a possibly-empty, canonically ordered list of {@link NodeId}s.
   */
  lookupAcrossScopes(fqn: string): readonly NodeId[];
}

/** Builds a {@link SymbolTable} from a fully extracted node set (design: R4). */
export interface SymbolTableBuilder {
  build(nodes: GraphNode[]): SymbolTable;
}

/**
 * Derive the FQN key for a `class` node in import-form (dotted, not $ form).
 *
 * After Gap 5 (Fix 7), class ids use `$$` to escape literal `$` in identifier
 * segments, while a single `$` denotes the nested-type separator. To produce
 * the import-form key that the stitcher looks up (e.g. "com.example.Outer.Inner"
 * for a nested class), we:
 * 1. Strip the "class:" prefix.
 * 2. Replace `$$` (escaped literal $) with a placeholder that cannot appear in
 *    any id, to avoid double-converting it.
 * 3. Replace the remaining single `$` (nested-type separators) with `.`.
 * 4. Restore the placeholder as literal `$`.
 *
 * This builds the key from the structural encoding rather than id-slicing alone
 * (R4.2, R4.3; Fix 7 preferred approach).
 *
 * Example:
 *   "class:com.example.Outer$Inner"   -> "com.example.Outer.Inner"  (nested)
 *   "class:com.example.Outer$$Inner"  -> "com.example.Outer$Inner"  (top-level with $ in name)
 */
function classKey(node: GraphNode): string {
  let fqn = node.id.slice(CLASS_ID_PREFIX.length);
  // Strip the source-root scope prefix, if any (Fix 24 — Gap 2). A Java FQN
  // never contains `|`, so the scope↔FQN boundary is the last `|`.
  const bar = fqn.lastIndexOf("|");
  if (bar >= 0) {
    fqn = fqn.slice(bar + 1);
  }
  // Placeholder chosen outside the range of any id character set.
  const PLACEHOLDER = "\x00";
  return fqn
    .replace(/\$\$/g, PLACEHOLDER)      // protect escaped $$
    .replace(/\$/g, ".")                  // convert separator $ to .
    .replace(/\x00/g, "$");             // restore literal $
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
  let body = node.id.slice(FUNCTION_ID_PREFIX.length);
  // Strip the source-root scope prefix, if any (Fix 24 — Gap 2): the scope sits
  // before the enclosing FQN and the last `|` is its boundary.
  const scopeBar = body.lastIndexOf("|");
  if (scopeBar >= 0) {
    body = body.slice(scopeBar + 1);
  }
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
 * Extract the source-root scope encoded in a `class` / `function` id, or `""`
 * when the id is unscoped (repository-root source root) (Fix 24 — Gap 2). The
 * scope sits before the last `|`; a Java FQN never contains `|`, so the
 * boundary is unambiguous. Non-keyed nodes (`file`) have no scope key.
 */
function scopeOf(node: GraphNode): string {
  const prefixLen =
    node.kind === "class" ? CLASS_ID_PREFIX.length : FUNCTION_ID_PREFIX.length;
  const rest = node.id.slice(prefixLen);
  const bar = rest.lastIndexOf("|");
  return bar >= 0 ? rest.slice(0, bar) : "";
}

/** Separator joining a scope and an FQN into a composite map key (NUL is never in an id). */
const SCOPE_KEY_SEPARATOR = "\u0000";

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
  // Per-(scope, fqn) index for classpath-local resolution (canonical-first on
  // collision within a scope), and a per-fqn index listing every defining node
  // across all scopes in canonical order for the cross-scope fallback.
  const byScopeFqn = new Map<string, NodeId>();
  const byFqn = new Map<string, NodeId[]>();

  // Iterate in canonical id order (byte-wise UTF-8) so that "first insert wins"
  // deterministically retains the canonical-first node on collision, and the
  // per-fqn lists are in canonical order (R4.5, R4.6).
  const ordered = [...nodes].sort(compareNodes);
  for (const node of ordered) {
    const key = keyFor(node);
    if (key === null) {
      continue;
    }
    const scopeKey = scopeOf(node) + SCOPE_KEY_SEPARATOR + key;
    if (!byScopeFqn.has(scopeKey)) {
      byScopeFqn.set(scopeKey, node.id);
    }
    const list = byFqn.get(key);
    if (list === undefined) {
      byFqn.set(key, [node.id]);
    } else {
      list.push(node.id);
    }
  }

  return {
    lookup(fqn: string): NodeId | null {
      const list = byFqn.get(fqn);
      // Canonical-first across all scopes (byFqn is built in canonical order).
      return list === undefined || list.length === 0 ? null : list[0]!;
    },
    lookupInScope(scope: string, fqn: string): NodeId | null {
      const found = byScopeFqn.get(scope + SCOPE_KEY_SEPARATOR + fqn);
      return found === undefined ? null : found;
    },
    lookupAcrossScopes(fqn: string): readonly NodeId[] {
      return byFqn.get(fqn) ?? [];
    },
  };
}
