/**
 * AstExtractor (R3) — parse a single Java source file with the Tree-Sitter Java
 * grammar into a transient AST and extract its `file` / `class` / `function`
 * nodes.
 *
 * This module owns the Tree-Sitter wrapper. `web-tree-sitter` (the WASM build)
 * is chosen over native bindings to avoid native-compilation friction across
 * platforms and CI (design: "Technology choices"); the grammar binding is
 * isolated here so it can be swapped without touching downstream logic.
 *
 * Behavior per file (design: "AstExtractor (R3)"):
 * - Parse the file into a transient {@link Tree} (R3.1).
 * - Emit exactly one `file` node (R3.2); one `class` node per class / interface
 *   / enum / record declaration, including nested and inner types (R3.3); one
 *   `function` node per method / constructor, one per overload distinguished by
 *   its declared parameter-type list (R3.4).
 * - Read the `package_declaration` once and apply its dotted name as
 *   `packagePath` to every node in the file, or `""` when absent (R3.7, R3.8).
 * - Record `directoryPath` as the POSIX directory of the file's `relativePath`,
 *   with no leading separator and `""` at the root (R3.5, R3.6).
 * - Give every `class` / `function` node a `definedInFile` equal to the file
 *   node's id (R3.9).
 * - **Discard the AST** as soon as extraction returns; only the plain-data
 *   {@link GraphNode}s and {@link RawReference}s survive (R3.13).
 *
 * ## Initialization vs extraction
 *
 * `web-tree-sitter` requires an asynchronous one-time initialization
 * ({@link Parser.init} + {@link Language.load}), after which parsing is
 * synchronous. {@link createAstExtractor} performs that async setup once and
 * returns an {@link AstExtractor} whose {@link AstExtractor.extract} is
 * synchronous, so the orchestrator can initialize a single extractor and then
 * loop over the collected files deterministically.
 *
 * ## Raw references and per-file errors (Task 5.2)
 *
 * On top of node extraction this module emits {@link RawReference} records for
 * `import` declarations ({@link collectReferences}) and handles recoverable
 * per-file failures: an unreadable file records `file-unreadable`, and source
 * that the grammar cannot process into a valid tree (Tree-Sitter marks it with
 * ERROR nodes, surfaced via `rootNode.hasError`) records `file-unparseable`.
 * Both cases return `null` so the orchestrator continues with the remaining
 * files (R10.1, R10.2).
 */

import { createRequire } from "node:module";
import * as nodeFs from "node:fs";
import * as path from "node:path";

import { Language, Parser, type Node } from "web-tree-sitter";

import type { GraphNode, NodeId } from "@repohive/shared";
import { buildClassFqn, buildClassId, buildFileId, buildFunctionId } from "./ids.js";
import { deriveSourceRoot } from "./source-root.js";
import { makeError, type ParseErrorCollector } from "./errors.js";
import type { CollectedFile, ExtractionResult, RawReference } from "./types.js";

/**
 * The AstExtractor interface (design: "AstExtractor (R3)").
 *
 * `extract` is synchronous: the Tree-Sitter parser and Java language are loaded
 * once by {@link createAstExtractor} before any file is parsed.
 */
export interface AstExtractor {
  /**
   * Parse and extract a single Java source file.
   *
   * @param file the collected file to parse.
   * @param errors collector for recoverable per-file errors (R10.1, R10.2).
   * @returns the file's {@link ExtractionResult}, or `null` when the file could
   *   not be read or parsed (the error is recorded in `errors` and the caller
   *   continues with the remaining files).
   */
  extract(file: CollectedFile, errors: ParseErrorCollector): ExtractionResult | null;
}

/**
 * Filesystem operations the extractor depends on. Defaults to `node:fs`; tests
 * inject a stub to drive extraction from in-memory sources and to simulate read
 * failures without touching the real filesystem.
 */
export interface AstExtractorDeps {
  /** Read a Java source file as a UTF-8 string. */
  readFile(absolutePath: string): string;
}

const defaultDeps: AstExtractorDeps = {
  readFile: (absolutePath) => nodeFs.readFileSync(absolutePath, "utf8"),
};

/**
 * Grammar-loading configuration. Both WASM artifacts ship as prebuilt files in
 * their npm packages, so the defaults resolve them from `node_modules` with no
 * build step. The paths are overridable for robustness (e.g. bundled or
 * relocated deployments) and for tests.
 */
export interface GrammarOptions {
  /**
   * Absolute path to the `web-tree-sitter` core runtime WASM
   * (`web-tree-sitter.wasm`). Defaults to the file shipped alongside the
   * `web-tree-sitter` package entry.
   */
  coreWasmPath?: string;
  /**
   * Absolute path to the compiled Java grammar WASM
   * (`tree-sitter-java.wasm`). Defaults to the file shipped in the
   * `tree-sitter-java` package.
   */
  javaWasmPath?: string;
}

// --------------------------------------------------------------------------
// Grammar (WASM) resolution.
// --------------------------------------------------------------------------

/**
 * Resolve the two prebuilt WASM artifacts from `node_modules`.
 *
 * - The Java grammar (`tree-sitter-java.wasm`) is published as a top-level file
 *   in the `tree-sitter-java` package (its `package.json` `files` list includes
 *   `*.wasm`), so it resolves directly via a package subpath.
 * - The `web-tree-sitter` core runtime WASM sits next to the package's module
 *   entry; because the package exposes an `exports` map we resolve the entry and
 *   take its sibling `.wasm` rather than resolving the subpath directly.
 *
 * Using `createRequire(import.meta.url).resolve` makes resolution deterministic
 * and independent of the process working directory.
 */
function resolveGrammarPaths(options: GrammarOptions): {
  coreWasmPath: string;
  javaWasmPath: string;
} {
  const require = createRequire(import.meta.url);

  const coreWasmPath =
    options.coreWasmPath ??
    path.join(path.dirname(require.resolve("web-tree-sitter")), "web-tree-sitter.wasm");

  const javaWasmPath =
    options.javaWasmPath ?? require.resolve("tree-sitter-java/tree-sitter-java.wasm");

  return { coreWasmPath, javaWasmPath };
}

/**
 * Node type names in the Tree-Sitter Java grammar that declare a *type* and
 * therefore map to a `class` {@link GraphNode} (R3.3). `annotation_type_declaration`
 * (`@interface`) is included as a declared interface-like type for completeness.
 */
const TYPE_DECLARATION_TYPES = new Set<string>([
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "annotation_type_declaration",
]);

/**
 * Node type names in the Tree-Sitter Java grammar that declare a callable and
 * therefore map to a `function` {@link GraphNode} (R3.4).
 * `compact_constructor_declaration` is a record's canonical constructor.
 */
const FUNCTION_DECLARATION_TYPES = new Set<string>([
  "method_declaration",
  "constructor_declaration",
  "compact_constructor_declaration",
]);

/**
 * Derive the `directoryPath` of a file node from its POSIX root-relative path:
 * the directory portion with no leading separator, or `""` when the file sits
 * directly in the project root (R3.5, R3.6).
 */
function directoryPathOf(relativePath: string): string {
  const dir = path.posix.dirname(relativePath);
  return dir === "." ? "" : dir;
}

/** Collapse internal whitespace runs to single spaces and trim (deterministic). */
function normalizeTypeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Derive the exact dotted name of a scoped_identifier or bare identifier
 * node by joining its identifier descendants with ".", ignoring whitespace
 * trivia and comments entirely (Fix 11 — Gap 7: structural qualified names).
 *
 * Reading the raw text span via node.text is wrong because "package com .
 * example;" produces "com . example" rather than "com.example", and a
 * comment inside the name ("com./x/example") leaks the comment text.
 * Walking the identifier descendants is exact: a scoped_identifier is a tree
 * of identifier children; joining them with "." is canonical regardless of
 * trivia the author wrote.
 *
 * Only identifier leaf nodes contribute segments; every other named child
 * (annotations, comments, brackets) is silently skipped by construction.
 *
 * @param node a scoped_identifier or bare identifier Tree-Sitter node.
 * @returns the canonical dotted name, e.g. "com.example.service".
 */
function dottedNameOf(node: Node): string {
  if (node.type === "identifier") {
    return node.text;
  }
  const segments: string[] = [];
  const walk = (n: Node): void => {
    for (const child of n.namedChildren) {
      if (child.type === "identifier") {
        segments.push(child.text);
      } else if (child.type === "scoped_identifier") {
        walk(child);
      }
      // Comments, annotations, and other extras are ignored by construction.
    }
  };
  walk(node);
  return segments.join(".");
}

/**
 * Read the file's declared package as a dotted name, or `""` for the default
 * package (R3.7, R3.8). The `package_declaration` carries the dotted name as a
 * `scoped_identifier` (or a bare `identifier` for a single-segment package).
 *
 * Uses {@link dottedNameOf} to build the name structurally, so whitespace and
 * comments inside the qualified name are ignored and the result is always in
 * canonical dotted form (Fix 11 — Gap 7).
 */
function readPackagePath(root: Node): string {
  for (const child of root.namedChildren) {
    if (child.type === "package_declaration") {
      for (const named of child.namedChildren) {
        if (named.type === "scoped_identifier" || named.type === "identifier") {
          return dottedNameOf(named);
        }
      }
    }
  }
  return "";
}

/**
 * Derive the declared type text from a single parameter node in a type-driven
 * way (Fix 9 — Gap 6): only the declared type, never the parameter name,
 * annotations, or comments.
 *
 * - For formal_parameter: read the "type" field, append "dimensions" field if
 *   present (handles C-style array-after-name like "int a[]").
 * - For spread_parameter: tree-sitter-java has no "type" FIELD on this node
 *   (Grammar trap 1), but the type IS present as a direct named child of the
 *   appropriate type; find it structurally then append exactly one "...".
 *
 * Returns null when no type can be determined (should not happen for
 * well-formed parameters; callers skip null results).
 */
function declaredTypeText(param: Node): string | null {
  if (param.type === "spread_parameter") {
    // tree-sitter-java's spread_parameter has children: [modifiers?] type name
    // The type node is the first non-annotation named child whose type ends with
    // "_type" or is "type_identifier" / "scoped_type_identifier" / "generic_type"
    // / "array_type".
    const typeChild = param.namedChildren.find((c) => {
      const t = c.type;
      return (
        t === "type_identifier" ||
        t === "scoped_type_identifier" ||
        t === "generic_type" ||
        t === "array_type" ||
        t.endsWith("_type")
      );
    });
    if (typeChild === null || typeChild === undefined) {
      return null;
    }
    return normalizeTypeText(typeChild.text) + "...";
  }

  // formal_parameter: read the "type" field + optional "dimensions" field
  const typeField = param.childForFieldName("type");
  if (typeField === null) {
    return null;
  }
  let text = normalizeTypeText(typeField.text);
  const dimensions = param.childForFieldName("dimensions");
  if (dimensions !== null) {
    text += normalizeTypeText(dimensions.text);
  }
  return text;
}

/**
 * For a compact_constructor_declaration (a record's canonical constructor),
 * derive the parameter-type list from the enclosing record_declaration's
 * record_header / formal_parameters. Returns null when the declaration cannot
 * be found (should not happen for well-formed records).
 */
function recordHeaderTypesOf(declaration: Node): string[] | null {
  // Walk up to find the enclosing record_declaration
  let current: Node | null = declaration.parent;
  while (current !== null && current.type !== "record_declaration") {
    current = current.parent;
  }
  if (current === null) {
    return null;
  }
  // The record_declaration has a "parameters" field (its record components)
  const params = current.childForFieldName("parameters");
  if (params === null) {
    return null;
  }
  const types: string[] = [];
  for (const param of params.namedChildren) {
    if (param.type !== "formal_parameter" && param.type !== "spread_parameter") {
      continue;
    }
    const text = declaredTypeText(param);
    if (text !== null) {
      types.push(text);
    }
  }
  return types;
}

/**
 * Extract the declared parameter-type list of a callable, in source order, so
 * overloads are distinguished by their signature (R3.4).
 *
 * Type-driven (Fix 9 — Gap 6): only formal_parameter and spread_parameter nodes
 * are processed; comments, annotations, receiver_parameters, and any other
 * named children of the parameter list are ignored. The type text comes from
 * the declared "type" field (never the parameter name or raw text), so renaming
 * a parameter or editing a comment cannot change the id (R3.11 stability).
 *
 * Compact constructors (record canonical constructors) have no "parameters"
 * node; their signature is derived from the enclosing record_declaration's
 * record header components so the id reflects the real signature.
 */
function parameterTypesOf(declaration: Node): string[] {
  const parameters = declaration.childForFieldName("parameters");

  if (parameters === null) {
    // compact_constructor_declaration: synthesize from the record header
    if (declaration.type === "compact_constructor_declaration") {
      return recordHeaderTypesOf(declaration) ?? [];
    }
    return [];
  }

  const types: string[] = [];
  for (const param of parameters.namedChildren) {
    // Only process actual parameter nodes; skip receiver_parameter, modifiers,
    // annotations at the list level, and any comment extras.
    if (param.type !== "formal_parameter" && param.type !== "spread_parameter") {
      continue;
    }
    const text = declaredTypeText(param);
    if (text !== null) {
      types.push(text);
    }
  }
  return types;
}

/**
 * Walk up the tree from a node to find the nearest enclosing scope —
 * a block (method/constructor/initializer body) or class_body (class
 * declaration body). This is used to determine the correct scope for
 * computing anonymous-class occurrence indices.
 *
 * Returns null when no enclosing scope can be found (the node is at
 * file scope).
 */
function findEnclosingScope(node: Node): Node | null {
  let current: Node | null = node.parent;
  while (current !== null) {
    if (current.type === "block" || current.type === "class_body") {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Derive the base type name for an object_creation_expression node — the
 * instantiated type as written, normalized. Returns "" when no type can be
 * found (should not happen for well-formed code).
 */
function anonymousBaseTypeName(node: Node): string {
  const typeNode = node.childForFieldName("type");
  if (typeNode === null) return "";
  return normalizeTypeText(typeNode.text);
}

/**
 * Compute the 0-based occurrence index of an anonymous-class body among all
 * object_creation_expression nodes with the same base type name that appear
 * within the given scope node (the enclosing block, class body, or method body),
 * ordered by their start byte position (source order).
 *
 * Source order is content — positions are stable across repeated parses of
 * the same file — so this is a pure function of the tree with no run counter
 * (R3.10, R3.11).
 */
function anonymousOccurrenceIndex(scope: Node, target: Node, baseType: string): number {
  const positions: number[] = [];
  const collectAnon = (n: Node): void => {
    for (const child of n.namedChildren) {
      if (
        child.type === "object_creation_expression" &&
        child.namedChildren.some((c) => c.type === "class_body") &&
        anonymousBaseTypeName(child) === baseType
      ) {
        positions.push(child.startIndex);
      }
      collectAnon(child);
    }
  };
  collectAnon(scope);
  positions.sort((a, b) => a - b);
  const targetPos = target.startIndex;
  const idx = positions.indexOf(targetPos);
  return idx >= 0 ? idx : 0;
}

/**
 * Derive the scope segment for a function declaration, used when recursing
 * into its body so that local classes declared inside are correctly scoped.
 * The segment has the form "name(paramTypes)" — the same substring that
 * appears after "#" in the function's own id.
 */
function functionScopeSegment(child: Node, typeChain: readonly string[]): string {
  const nameNode = child.childForFieldName("name");
  const functionName = nameNode !== null ? nameNode.text : typeChain[typeChain.length - 1] ?? "";
  const parameterTypes = parameterTypesOf(child);
  return `${functionName}(${parameterTypes.join(",")})`;
}

/**
 * Recursively walk a subtree, emitting `class` and `function` nodes. The
 * `typeChain` is the enclosing declared-type chain (outermost first); it is
 * empty at file scope. Nodes are de-duplicated by id so no two distinct nodes
 * ever share an identifier (R3.12).
 *
 * Scope segments (Fix 8 — Gap 4): every naming scope pushes a segment onto
 * the chain, not only named type declarations:
 * - named type declarations (as before): push the declared simple name
 * - enum_constant with a class body: push the constant name as a segment
 * - object_creation_expression with a body (anonymous class): push a
 *   content-derived segment "<BaseType>#<occurrenceIndex>" so members of two
 *   anonymous bodies of the same type in one method are distinct
 * - function declaration: recurse with an added method-signature segment so
 *   local classes in different methods with the same name are distinct
 */
function walkDeclarations(
  node: Node,
  typeChain: readonly string[],
  packagePath: string,
  directoryPath: string,
  fileId: NodeId,
  nodesById: Map<NodeId, GraphNode>,
  sourceRoot: string,
): void {
  for (const child of node.namedChildren) {
    if (TYPE_DECLARATION_TYPES.has(child.type)) {
      const nameNode = child.childForFieldName("name");
      // A type declaration with no name is malformed; skip it but continue.
      if (nameNode === null) {
        walkDeclarations(child, typeChain, packagePath, directoryPath, fileId, nodesById, sourceRoot);
        continue;
      }
      const nextChain = [...typeChain, nameNode.text];
      const classId = buildClassId(packagePath, nextChain, sourceRoot);
      if (!nodesById.has(classId)) {
        const classNode: GraphNode = {
          id: classId,
          kind: "class",
          directoryPath,
          definedInFile: fileId,
        };
        if (packagePath.length > 0) {
          classNode.packagePath = packagePath;
        }
        nodesById.set(classId, classNode);
      }
      // Recurse into the type body with the extended chain so nested / inner
      // types and their members are captured at any depth (R3.3).
      walkDeclarations(child, nextChain, packagePath, directoryPath, fileId, nodesById, sourceRoot);
      continue;
    }

    // Enum constant with a class body (Fix 8 — Gap 4): the constant's name IS
    // a naming scope — push it so methods/types declared in different enum
    // constants are distinct. Only recurse when a body actually exists;
    // plain constants with no body need no extra segment.
    // The grammar field is named "body" (not "class_body") on enum_constant.
    if (child.type === "enum_constant") {
      const nameNode = child.childForFieldName("name");
      if (nameNode !== null && child.childForFieldName("body") !== null) {
        const nextChain = [...typeChain, nameNode.text];
        walkDeclarations(child, nextChain, packagePath, directoryPath, fileId, nodesById, sourceRoot);
      } else {
        walkDeclarations(child, typeChain, packagePath, directoryPath, fileId, nodesById, sourceRoot);
      }
      continue;
    }

    // Anonymous class body (Fix 8 — Gap 4): object_creation_expression with
    // a class_body child is an anonymous class instantiation. Emit a class node
    // for the anonymous class itself and recurse with an extended chain so
    // its members are correctly scoped. The segment is "<BaseType>#<k>" where
    // k is the occurrence index of this anonymous body among same-type siblings
    // in source order — a pure function of the tree, never a run counter.
    // NOTE: class_body is in grammar's "children" array, not in "fields",
    // so we must find it as a named child, not via childForFieldName().
    if (
      child.type === "object_creation_expression" &&
      child.namedChildren.some((c) => c.type === "class_body")
    ) {
      const baseType = anonymousBaseTypeName(child);
      const seg = baseType !== "" ? baseType : "anon";
      // Find the nearest enclosing block or class_body to use as the scope
      // for the occurrence index, so two anonymous classes at different nesting
      // depths or in different methods stay distinct.
      const scopeNode = findEnclosingScope(child);
      const k = anonymousOccurrenceIndex(scopeNode ?? child, child, seg);
      const segment = `${seg}#${k}`;
      const nextChain = [...typeChain, segment];

      // Emit a class node for the anonymous class itself (R3.3 — "each class
      // declaration"; anonymous classes are class declarations in the JLS).
      if (nextChain.length > 0) {
        const classId = buildClassId(packagePath, nextChain, sourceRoot);
        if (!nodesById.has(classId)) {
          const classNode: GraphNode = {
            id: classId,
            kind: "class",
            directoryPath,
            definedInFile: fileId,
          };
          if (packagePath.length > 0) {
            classNode.packagePath = packagePath;
          }
          nodesById.set(classId, classNode);
        }
      }

      walkDeclarations(child, nextChain, packagePath, directoryPath, fileId, nodesById, sourceRoot);
      continue;
    }

    if (FUNCTION_DECLARATION_TYPES.has(child.type)) {
      // A callable is only meaningful inside a declared type; when one appears
      // at file scope (malformed input) there is no enclosing FQN, so skip it.
      if (typeChain.length > 0) {
        const enclosingFqn = buildClassFqn(packagePath, typeChain);
        // Compact constructors take the record's name; other callables carry a
        // `name` field. Fall back to the enclosing type's simple name.
        const nameNode = child.childForFieldName("name");
        const functionName = nameNode !== null ? nameNode.text : typeChain[typeChain.length - 1]!;
        const parameterTypes = parameterTypesOf(child);
        const functionId = buildFunctionId(enclosingFqn, functionName, parameterTypes, sourceRoot);
        if (!nodesById.has(functionId)) {
          const functionNode: GraphNode = {
            id: functionId,
            kind: "function",
            directoryPath,
            definedInFile: fileId,
          };
          if (packagePath.length > 0) {
            functionNode.packagePath = packagePath;
          }
          nodesById.set(functionId, functionNode);
        }
      }
      // Recurse into the body with a method-scope segment (Fix 8 — Gap 4) so
      // local classes declared inside different methods with the same simple
      // name are disambiguated: Helper inside a() -> "a()$Helper", inside
      // b() -> "b()$Helper". Only push the segment when we are already inside
      // a type (typeChain non-empty) — file-scope callables are skipped above.
      if (typeChain.length > 0) {
        const methodSeg = functionScopeSegment(child, typeChain);
        walkDeclarations(
          child,
          [...typeChain, methodSeg],
          packagePath,
          directoryPath,
          fileId,
          nodesById,
          sourceRoot,
        );
      } else {
        walkDeclarations(child, typeChain, packagePath, directoryPath, fileId, nodesById, sourceRoot);
      }
      continue;
    }

    // Any other node: recurse to find declarations nested within it.
    walkDeclarations(child, typeChain, packagePath, directoryPath, fileId, nodesById, sourceRoot);
  }
}

// ---------------------------------------------------------------------------
// Type-use reference extraction (Gap 1a / Fix 21)
// ---------------------------------------------------------------------------

/**
 * Node types whose `type` *field* carries a declared Java type.
 * Verified empirically against the pinned tree-sitter-java WASM grammar.
 * Note: `spread_parameter` is handled separately in collectTypeReferences
 * because it has no `type` field — the type is a direct named child.
 */
const TYPED_BY_FIELD = new Set<string>([
  "field_declaration",
  "method_declaration",
  "formal_parameter",
  "local_variable_declaration",
  "object_creation_expression",
]);

/**
 * Wrapper node types whose *children* are all declared types (not using the
 * `type` field).
 */
const TYPE_WRAPPERS = new Set<string>([
  "superclass",
  "super_interfaces",
  "type_list",
  "throws",
  "type_arguments",
]);

/**
 * Node types that carry a type *name*.  Primitives have their own node types
 * (`integral_type`, `floating_point_type`, `boolean_type`, `void_type`) and
 * are therefore excluded for free by restricting to these two names.
 */
const TYPE_NAME_NODE_TYPES = new Set<string>(["type_identifier", "scoped_type_identifier"]);

/**
 * Extract declared type names reachable from a single type node, without
 * descending into a scoped name's own segments (Grammar trap 2: descending
 * into `scoped_type_identifier` children yields fragments, not the full name)
 * and skipping `var` (Grammar trap 3: `var` appears as `type_identifier`).
 *
 * Results are pushed into `out` so callers can accumulate across multiple
 * positions without intermediate allocations.
 */
export function typeNamesOf(typeNode: Node, out: string[]): void {
  if (TYPE_NAME_NODE_TYPES.has(typeNode.type)) {
    const text = normalizeTypeText(typeNode.text);
    // Skip the `var` keyword — it is a synthetic type_identifier in the
    // grammar but carries no class reference (Grammar trap 3).
    if (text !== "var") {
      out.push(text); // do NOT recurse: scoped names are atomic (Grammar trap 2)
    }
    return;
  }
  // generic_type wraps a type_identifier + type_arguments; array_type wraps a
  // type_identifier + dimensions.  Recurse into their children to reach both
  // the base type and any type arguments.
  if (typeNode.type === "generic_type" || typeNode.type === "array_type") {
    for (const child of typeNode.namedChildren) {
      typeNamesOf(child, out);
    }
    return;
  }
  // type_arguments is a list of type names inside `< >`.
  if (typeNode.type === "type_arguments") {
    for (const child of typeNode.namedChildren) {
      typeNamesOf(child, out);
    }
    return;
  }
  // type_list is the concrete child of super_interfaces / throws — it holds a
  // comma-separated list of type_identifier or generic_type nodes.
  if (typeNode.type === "type_list") {
    for (const child of typeNode.namedChildren) {
      typeNamesOf(child, out);
    }
    return;
  }
  // Primitives, wildcards, dimensions, annotation nodes at the type level:
  // contribute no type name — fall through silently.
}

/**
 * Recursively walk the syntax tree and collect every declared-type-position
 * type name as a `"type-use"` {@link RawReference}.
 *
 * References are **file-scoped** (`fromNodeId = fileId`), matching how import
 * references are modelled — the grouping core attributes edges to files.
 *
 * Grammar traps (all verified empirically):
 * 1. Type positions use `type_identifier`, not `identifier` — the distinction
 *    makes collection tractable without name-resolution guesswork.
 * 2. `scoped_type_identifier` must NOT be descended into — handled by
 *    {@link typeNamesOf}.
 * 3. `var` appears as a `type_identifier` — excluded by {@link typeNamesOf}.
 *
 * The `spread_parameter` node has no `type` *field* (Grammar trap 1 from the
 * design), so it is handled separately by walking its named children.
 */
export function collectTypeReferences(root: Node, fileId: NodeId): RawReference[] {
  const references: RawReference[] = [];
  const names: string[] = [];

  function walk(node: Node): void {
    for (const child of node.namedChildren) {
      // Nodes whose `type` field holds a declared type.
      if (TYPED_BY_FIELD.has(child.type)) {
        const typeField = child.childForFieldName("type");
        if (typeField !== null) {
          names.length = 0;
          typeNamesOf(typeField, names);
          for (const name of names) {
            references.push({ fromNodeId: fileId, targetName: name, kind: "type-use" });
          }
          names.length = 0;
        }
        // Recurse into the node body so nested declarations are visited.
        walk(child);
        continue;
      }

      // spread_parameter has no `type` field (Grammar trap 1): the type is a
      // direct named child.  It appears inside formal_parameters, which is not
      // in TYPED_BY_FIELD, so it must be handled here rather than above.
      if (child.type === "spread_parameter") {
        names.length = 0;
        for (const c of child.namedChildren) {
          typeNamesOf(c, names);
        }
        for (const name of names) {
          references.push({ fromNodeId: fileId, targetName: name, kind: "type-use" });
        }
        names.length = 0;
        continue;
      }

      // Wrapper nodes whose children are all declared types.
      if (TYPE_WRAPPERS.has(child.type)) {
        names.length = 0;
        for (const c of child.namedChildren) {
          typeNamesOf(c, names);
        }
        for (const name of names) {
          references.push({ fromNodeId: fileId, targetName: name, kind: "type-use" });
        }
        names.length = 0;
        // Do NOT recurse further into wrapper nodes — their children are type
        // names, not declaration bodies.
        continue;
      }

      // Any other node: recurse to find declarations nested within it.
      walk(child);
    }
  }

  walk(root);
  return references;
}

/**
 * Collect the file's unresolved cross-file references for the
 * {@link import("./stitcher.js")} to resolve against the symbol table (R3.1
 * feeds R5 stitching).
 *
 * Phase 1 populates **import declarations** — the references that drive
 * `importFrequency`, the only frequency signal computed in Phase 1 (design:
 * "AstExtractor (R3)" and "Stitcher (R5, R6)"). Type-use and method-call
 * references are intentionally left for a later phase: their frequency signals
 * (`methodCallFrequency`, `sharedTypeCount`) are fixed at `0` in Phase 1, so
 * collecting them now would produce dead data. The single-kind design keeps the
 * seam clear and the output deterministic.
 *
 * Import references are file-scoped: an `import` names a type (or static
 * member) that the whole compilation unit may depend on, so `fromNodeId` is the
 * file node's id. The imported name is recorded exactly as written — a dotted
 * `scoped_identifier` (or a bare `identifier` for a single segment) — so the
 * stitcher can resolve it through the symbol table; wildcard imports keep their
 * trailing `.*` and simply resolve to nothing (no matching FQN), which is the
 * correct Phase-1 behavior.
 *
 * References are emitted in source order; the stitcher derives its
 * deterministic edge set from the canonically-ordered node set and symbol
 * table, so reference order does not affect the output (R5.7, R6.7).
 */
function collectReferences(root: Node, fileId: NodeId): RawReference[] {
  const references: RawReference[] = [];
  for (const child of root.namedChildren) {
    if (child.type !== "import_declaration") {
      continue;
    }
    // An `import_declaration` carries the imported name as a `scoped_identifier`
    // (dotted) or a bare `identifier`, optionally followed by an `asterisk`
    // named node for a wildcard (`import com.example.*;`). The `static` keyword
    // is an anonymous token and does not change the name we record.
    let name: string | null = null;
    let wildcard = false;
    for (const named of child.namedChildren) {
      if (named.type === "scoped_identifier" || named.type === "identifier") {
        // Use dottedNameOf for structural traversal so whitespace/comments in
        // the import name (e.g. `import com . example . Foo;`) are stripped
        // canonically rather than preserved (Fix 11 — Gap 7).
        name = dottedNameOf(named);
      } else if (named.type === "asterisk") {
        wildcard = true;
      }
    }
    if (name !== null) {
      references.push({
        fromNodeId: fileId,
        targetName: wildcard ? `${name}.*` : name,
        kind: "import",
      });
    }
  }
  return references;
}

/**
 * Extract every node from a parsed file's syntax-tree root. Pure over the AST:
 * it reads structural attributes only and never retains a reference to the tree
 * (R3.13 is enforced by the caller deleting the tree immediately after).
 */
function extractFromRoot(root: Node, file: CollectedFile): ExtractionResult {
  const packagePath = readPackagePath(root);
  const directoryPath = directoryPathOf(file.relativePath);
  const fileId = buildFileId(file.relativePath);
  // Source root scopes class/function ids so the same FQN in two modules does
  // not collide (Fix 24 — Gap 2). Derived from the package↔directory law.
  const sourceRoot = deriveSourceRoot(file.relativePath, packagePath);

  const nodesById = new Map<NodeId, GraphNode>();

  // Exactly one `file` node per parsed file (R3.2). File nodes carry no
  // `definedInFile` and omit `packagePath` when the file declares no package.
  const fileNode: GraphNode = { id: fileId, kind: "file", directoryPath };
  if (packagePath.length > 0) {
    fileNode.packagePath = packagePath;
  }
  nodesById.set(fileId, fileNode);

  walkDeclarations(root, [], packagePath, directoryPath, fileId, nodesById, sourceRoot);

  return {
    nodes: [...nodesById.values()],
    references: [...collectReferences(root, fileId), ...collectTypeReferences(root, fileId)],
    packagePath,
  };
}

/**
 * Create an {@link AstExtractor}, performing the one-time asynchronous
 * initialization of the Tree-Sitter runtime and the Java grammar.
 *
 * The returned extractor's {@link AstExtractor.extract} is synchronous and may
 * be called once per collected file; each call parses the file into a transient
 * AST and discards it before returning (R3.13).
 *
 * @param deps filesystem dependency (defaults to `node:fs`).
 * @param grammar grammar-WASM path overrides (defaults resolve from
 *   `node_modules`).
 */
export async function createAstExtractor(
  deps: AstExtractorDeps = defaultDeps,
  grammar: GrammarOptions = {},
): Promise<AstExtractor> {
  const { coreWasmPath, javaWasmPath } = resolveGrammarPaths(grammar);

  // Initialize the Emscripten runtime, pointing it at the core WASM explicitly
  // so resolution does not depend on the process working directory.
  await Parser.init({ locateFile: () => coreWasmPath });

  const language = await Language.load(new Uint8Array(nodeFs.readFileSync(javaWasmPath)));

  const parser = new Parser();
  parser.setLanguage(language);

  return {
    extract(file, errors) {
      let source: string;
      try {
        source = deps.readFile(file.absolutePath);
      } catch {
        // The file could not be read from disk; record and continue (R10.2).
        errors.add(
          makeError(
            "file-unreadable",
            `Java source file could not be read: ${file.relativePath}`,
            file.relativePath,
          ),
        );
        return null;
      }

      const tree = parser.parse(source);
      if (tree === null) {
        // The grammar could not produce a tree at all; treat as unparseable
        // (R10.1).
        errors.add(
          makeError(
            "file-unparseable",
            `Java source file could not be parsed: ${file.relativePath}`,
            file.relativePath,
          ),
        );
        return null;
      }

      try {
        // Tree-Sitter is error-tolerant: rather than returning `null` for
        // invalid input it returns a tree containing ERROR / MISSING nodes.
        // `hasError` is the cheap, deterministic signal that the source is not
        // syntactically valid Java the grammar could process into usable
        // declarations, so we record `file-unparseable` and continue with the
        // remaining files (R10.1). The tree is still discarded in `finally`.
        if (tree.rootNode.hasError) {
          errors.add(
            makeError(
              "file-unparseable",
              `Java source file could not be parsed: ${file.relativePath}`,
              file.relativePath,
            ),
          );
          return null;
        }
        return extractFromRoot(tree.rootNode, file);
      } finally {
        // Discard the transient AST immediately; only plain-data nodes /
        // references survive extraction (R3.13).
        tree.delete();
      }
    },
  };
}
