/**
 * Content-derived node-ID scheme (design: "Node identity (ids.ts)").
 *
 * Node IDs are derived **solely** from an entity's stable structural attributes
 * — its package, enclosing-type chain, entity name, and (for functions) its
 * declared parameter-type list. They are NEVER derived from sequential
 * counters, timestamps / wall-clock values, random values, memory addresses, or
 * filesystem enumeration order (R3.10). Because every builder here is a pure
 * function of its structural inputs, re-parsing an unchanged entity yields an
 * identical id across runs (R3.11), and structurally distinct entities yield
 * distinct ids (R3.12).
 *
 * The only path material permitted in an id is a forward-slash, root-relative
 * path (`relativePath`); absolute or host-specific paths never enter an id
 * (R9.4). {@link buildFileId} enforces this at the boundary.
 *
 * ## $ encoding (Fix 7 — Gap 5)
 *
 * `$` is both a legal Java identifier character and the nested-type separator
 * used in class FQNs (mirroring the JVM binary-name convention). To make the
 * encoding unambiguously decodable, literal `$` characters inside a segment are
 * escaped to `$$` before the chain is joined with the single-`$` separator:
 *
 *   `class Outer$Inner` (one type, `$` in name) -> segment `Outer$$Inner`
 *   `Outer.Inner` (nested, `$` is the separator) -> `Outer$Inner`
 *
 * The mapping is injective: a run of `$$` only ever arises from escaping,
 * a single `$` only ever arises from the separator.
 *
 * ## Source-root scope (Fix 24 — Gap 2)
 *
 * A Java FQN is unique only within one source root, so multi-module repos can
 * declare the same FQN twice. `class` and `function` ids therefore carry an
 * optional source-root scope prefix `<scope>|` (the scope is derived by
 * `source-root.ts`). An empty scope (repository-root source root) omits the
 * separator, so single-root ids keep their unscoped form. A Java FQN never
 * contains `|`, so the scope↔FQN boundary is unambiguously the last `|` and no
 * escaping is needed. `file` ids are never scoped — a path is already unique.
 *
 * Canonical id string forms:
 *
 * | Kind     | Form                                                        | Example                                             |
 * |----------|-------------------------------------------------------------|-----------------------------------------------------|
 * | file     | file: + relativePath                                        | file:src/com/example/UserService.java               |
 * | class    | class: + FQN (packagePath + $-joined escaped type chain)    | class:com.example.Outer$Inner                       |
 * | function | func: + enclosing-class FQN + #name( param types )          | func:com.example.UserService#save(com.example.User) |
 */

import type { NodeId } from "@repohive/shared";

/** ID prefix marking a `file` node. */
export const FILE_ID_PREFIX = "file:";
/** ID prefix marking a `class` node. */
export const CLASS_ID_PREFIX = "class:";
/** ID prefix marking a `function` node. */
export const FUNCTION_ID_PREFIX = "func:";

/** Separator between package segments and between the package and the type chain. */
const PACKAGE_SEPARATOR = ".";
/** Separator between nested type names (mirrors the JVM binary-name convention). */
const NESTED_TYPE_SEPARATOR = "$";
/** Separator between an enclosing-class FQN and a function name. */
const FUNCTION_NAME_SEPARATOR = "#";
/**
 * Separator between the source-root scope and the FQN in a scoped id
 * (Fix 24 — Gap 2). A Java FQN never contains `|`, so the scope↔FQN boundary is
 * always the last `|`; the encoding is unambiguously decodable without escaping.
 */
const SCOPE_SEPARATOR = "|";

/**
 * Prefix an id body with its source-root scope when the scope is non-empty
 * (Fix 24 — Gap 2). An empty scope (source root == repository root) omits the
 * separator, so single-source-root ids keep their unscoped form and FQN
 * uniqueness *within one root* is unaffected. A non-empty scope distinguishes
 * the same FQN declared under different source roots (the multi-module case),
 * which is what removes the duplicate-id collision.
 */
function withScope(scope: string, body: string): string {
  return scope.length === 0 ? body : scope + SCOPE_SEPARATOR + body;
}

/**
 * Guard: a `relativePath` that enters a file id MUST be a forward-slash,
 * root-relative POSIX path. This rejects host-specific path material (backslash
 * separators, a leading slash, or a drive-letter prefix) so that no absolute or
 * OS-dependent path can ever leak into a node id (R9.4).
 *
 * @throws {Error} when `relativePath` is empty or is not root-relative POSIX.
 */
function assertRootRelativePosixPath(relativePath: string): void {
  if (relativePath.length === 0) {
    throw new Error("relativePath must be a non-empty root-relative POSIX path");
  }
  if (relativePath.includes("\\")) {
    throw new Error(
      `relativePath must use forward-slash separators, not backslashes: ${relativePath}`,
    );
  }
  if (relativePath.startsWith("/")) {
    throw new Error(
      `relativePath must be root-relative (no leading slash): ${relativePath}`,
    );
  }
  if (/^[A-Za-z]:/.test(relativePath)) {
    throw new Error(
      `relativePath must not be an absolute host path with a drive letter: ${relativePath}`,
    );
  }
}

/**
 * Build the id of a `file` node from its root-relative POSIX path.
 *
 * @param relativePath forward-slash, root-relative path of the Java source file
 *   (e.g. `src/com/example/UserService.java`).
 * @returns the content-derived file node id (e.g.
 *   `file:src/com/example/UserService.java`).
 */
export function buildFileId(relativePath: string): NodeId {
  assertRootRelativePosixPath(relativePath);
  return FILE_ID_PREFIX + relativePath;
}

/**
 * Escape a single segment of the nested-type chain so literal `$` characters
 * in a Java identifier cannot be confused with the `$` separator between chain
 * segments (Fix 7 — Gap 5).
 *
 * Rule: every `$` in the segment is replaced with `$$`. The single-`$`
 * separator therefore unambiguously denotes a nesting boundary, and `$$` always
 * denotes a literal `$` in the identifier name.
 */
function escapeSegment(name: string): string {
  // Replace each $ with $$ (each literal dollar sign doubles).
  // The replacement string '$$$$' in JS String.replace is two literal dollar
  // signs in the output (each $$ in the replacement string means one $).
  return name.replace(/\$/g, "$$$$");
}

/**
 * Build the fully qualified name (FQN) of a class from its declared package and
 * its enclosing-type chain. The chain runs from the outermost declared type to
 * the type itself. Each segment is escaped (literal `$` -> `$$`) before being
 * joined with the single-`$` separator, so the encoding is unambiguously
 * decodable (Fix 7 — Gap 5). The package (when present) is joined to the chain
 * with `.`.
 *
 * @param packagePath declared dotted package, or "" for the default package.
 * @param nestedTypeNames enclosing-type chain, outermost first, at least one
 *   entry (the type's own simple name is the last element).
 * @returns the class FQN (e.g. "com.example.Outer$Inner", or "Outer$Inner" in
 *   the default package). A top-level class named "Outer$Inner" would produce
 *   "com.example.Outer$$Inner" — the $$ signals a literal $ in the name.
 * @throws {Error} when `nestedTypeNames` is empty.
 */
export function buildClassFqn(
  packagePath: string,
  nestedTypeNames: readonly string[],
): string {
  if (nestedTypeNames.length === 0) {
    throw new Error("a class FQN requires at least one type name");
  }
  const typeChain = nestedTypeNames.map(escapeSegment).join(NESTED_TYPE_SEPARATOR);
  return packagePath.length === 0
    ? typeChain
    : packagePath + PACKAGE_SEPARATOR + typeChain;
}

/**
 * Build the id of a `class` node.
 *
 * @param packagePath declared dotted package, or `""` for the default package.
 * @param nestedTypeNames enclosing-type chain, outermost first (see
 *   {@link buildClassFqn}).
 * @param scope the file's source root (see {@link withScope}); `""` (default)
 *   for a repository-root source root, leaving the id unscoped (Fix 24 — Gap 2).
 * @returns the content-derived class node id (e.g.
 *   `class:com.example.Outer$Inner`, or
 *   `class:src/test/java|com.example.Outer$Inner` when scoped).
 */
export function buildClassId(
  packagePath: string,
  nestedTypeNames: readonly string[],
  scope = "",
): NodeId {
  return CLASS_ID_PREFIX + withScope(scope, buildClassFqn(packagePath, nestedTypeNames));
}

/**
 * Build the id of a `function` node (method or constructor).
 *
 * The declared parameter-type list is part of the id, so overloads that share a
 * name but differ in parameter types produce distinct ids (R3.4).
 *
 * @param enclosingClassFqn FQN of the class declaring the function (see
 *   {@link buildClassFqn}).
 * @param functionName simple method / constructor name.
 * @param parameterTypes declared parameter types in source order (empty for a
 *   no-argument function).
 * @param scope the declaring file's source root (see {@link withScope}); `""`
 *   (default) leaves the id unscoped. The scope must match the enclosing
 *   class's scope so a method and its class share a source root (Fix 24 — Gap 2).
 * @returns the content-derived function node id (e.g.
 *   `func:com.example.UserService#save(com.example.User)`).
 */
export function buildFunctionId(
  enclosingClassFqn: string,
  functionName: string,
  parameterTypes: readonly string[],
  scope = "",
): NodeId {
  const params = parameterTypes.join(",");
  return `${FUNCTION_ID_PREFIX}${withScope(
    scope,
    `${enclosingClassFqn}${FUNCTION_NAME_SEPARATOR}${functionName}(${params})`,
  )}`;
}
