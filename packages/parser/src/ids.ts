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
 * Canonical id string forms:
 *
 * | Kind     | Form                                                        | Example                                             |
 * |----------|-------------------------------------------------------------|-----------------------------------------------------|
 * | file     | `file:` + relativePath                                      | `file:src/com/example/UserService.java`             |
 * | class    | `class:` + FQN (packagePath + `$`-joined nested-type chain) | `class:com.example.Outer$Inner`                     |
 * | function | `func:` + enclosing-class FQN + `#name(` param types `)`    | `func:com.example.UserService#save(com.example.User)` |
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
 * Build the fully qualified name (FQN) of a class from its declared package and
 * its enclosing-type chain. The chain runs from the outermost declared type to
 * the type itself and is joined with `$` so nested / inner types are
 * unambiguous. The package (when present) is joined to the chain with `.`.
 *
 * @param packagePath declared dotted package, or `""` for the default package.
 * @param nestedTypeNames enclosing-type chain, outermost first, at least one
 *   entry (the type's own simple name is the last element).
 * @returns the class FQN (e.g. `com.example.Outer$Inner`, or `Outer$Inner` in
 *   the default package).
 * @throws {Error} when `nestedTypeNames` is empty.
 */
export function buildClassFqn(
  packagePath: string,
  nestedTypeNames: readonly string[],
): string {
  if (nestedTypeNames.length === 0) {
    throw new Error("a class FQN requires at least one type name");
  }
  const typeChain = nestedTypeNames.join(NESTED_TYPE_SEPARATOR);
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
 * @returns the content-derived class node id (e.g.
 *   `class:com.example.Outer$Inner`).
 */
export function buildClassId(
  packagePath: string,
  nestedTypeNames: readonly string[],
): NodeId {
  return CLASS_ID_PREFIX + buildClassFqn(packagePath, nestedTypeNames);
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
 * @returns the content-derived function node id (e.g.
 *   `func:com.example.UserService#save(com.example.User)`).
 */
export function buildFunctionId(
  enclosingClassFqn: string,
  functionName: string,
  parameterTypes: readonly string[],
): NodeId {
  const params = parameterTypes.join(",");
  return `${FUNCTION_ID_PREFIX}${enclosingClassFqn}${FUNCTION_NAME_SEPARATOR}${functionName}(${params})`;
}
