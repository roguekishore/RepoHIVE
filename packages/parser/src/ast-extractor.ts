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
 * Read the file's declared package as a dotted name, or `""` for the default
 * package (R3.7, R3.8). The `package_declaration` carries the dotted name as a
 * `scoped_identifier` (or a bare `identifier` for a single-segment package).
 */
function readPackagePath(root: Node): string {
  for (const child of root.namedChildren) {
    if (child.type === "package_declaration") {
      for (const named of child.namedChildren) {
        if (named.type === "scoped_identifier" || named.type === "identifier") {
          return normalizeTypeText(named.text);
        }
      }
    }
  }
  return "";
}

/**
 * Extract the declared parameter-type list of a callable, in source order, so
 * overloads are distinguished by their signature (R3.4). Receiver parameters
 * (`this`) are ignored; varargs are rendered with a trailing `...`.
 */
function parameterTypesOf(declaration: Node): string[] {
  const parameters = declaration.childForFieldName("parameters");
  if (parameters === null) {
    return [];
  }
  const types: string[] = [];
  for (const param of parameters.namedChildren) {
    if (param.type === "receiver_parameter") {
      continue;
    }
    const typeNode = param.childForFieldName("type");
    const baseText = typeNode !== null ? typeNode.text : param.text;
    let typeText = normalizeTypeText(baseText);
    const dimensions = param.childForFieldName("dimensions");
    if (dimensions !== null) {
      typeText += normalizeTypeText(dimensions.text);
    }
    if (param.type === "spread_parameter") {
      typeText += "...";
    }
    types.push(typeText);
  }
  return types;
}

/**
 * Recursively walk a subtree, emitting `class` and `function` nodes. The
 * `typeChain` is the enclosing declared-type chain (outermost first); it is
 * empty at file scope. Nodes are de-duplicated by id so no two distinct nodes
 * ever share an identifier (R3.12).
 */
function walkDeclarations(
  node: Node,
  typeChain: readonly string[],
  packagePath: string,
  directoryPath: string,
  fileId: NodeId,
  nodesById: Map<NodeId, GraphNode>,
): void {
  for (const child of node.namedChildren) {
    if (TYPE_DECLARATION_TYPES.has(child.type)) {
      const nameNode = child.childForFieldName("name");
      // A type declaration with no name is malformed; skip it but continue.
      if (nameNode === null) {
        walkDeclarations(child, typeChain, packagePath, directoryPath, fileId, nodesById);
        continue;
      }
      const nextChain = [...typeChain, nameNode.text];
      const classId = buildClassId(packagePath, nextChain);
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
      walkDeclarations(child, nextChain, packagePath, directoryPath, fileId, nodesById);
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
        const functionId = buildFunctionId(enclosingFqn, functionName, parameterTypes);
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
      // Recurse into the body to capture local / nested type declarations.
      walkDeclarations(child, typeChain, packagePath, directoryPath, fileId, nodesById);
      continue;
    }

    // Any other node: recurse to find declarations nested within it.
    walkDeclarations(child, typeChain, packagePath, directoryPath, fileId, nodesById);
  }
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
        name = normalizeTypeText(named.text);
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

  const nodesById = new Map<NodeId, GraphNode>();

  // Exactly one `file` node per parsed file (R3.2). File nodes carry no
  // `definedInFile` and omit `packagePath` when the file declares no package.
  const fileNode: GraphNode = { id: fileId, kind: "file", directoryPath };
  if (packagePath.length > 0) {
    fileNode.packagePath = packagePath;
  }
  nodesById.set(fileId, fileNode);

  walkDeclarations(root, [], packagePath, directoryPath, fileId, nodesById);

  return {
    nodes: [...nodesById.values()],
    references: collectReferences(root, fileId),
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
