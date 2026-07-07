/**
 * Tests for the AstExtractor (R3) — node extraction and raw-reference
 * collection with per-file error handling (Tasks 5.1 + 5.2).
 *
 * Coverage:
 * - Node extraction (R3.2–R3.9): exactly one `file` node; a `class` node per
 *   class / interface / enum / record including nested / inner types; a
 *   `function` node per method / constructor with overloads distinguished by
 *   parameter-type list; `packagePath` / `directoryPath` / `definedInFile`.
 * - Default package emits nodes with no `packagePath` (R3.8), and a root file
 *   emits `directoryPath: ""` (R3.6).
 * - Raw import references (R3.1 → R5): one `RawReference` per import, file
 *   scoped, name as written, wildcard preserved.
 * - Per-file errors (R10.1, R10.2): an unreadable file records `file-unreadable`
 *   and an unparseable file records `file-unparseable`; extraction continues
 *   with the remaining files.
 * - Property (fast-check): every extracted node carries the file's package and
 *   directory, and every `class` / `function` node references the file node via
 *   `definedInFile` (R3.7, R3.9).
 *
 * **Validates: Requirements 3.1, 10.1, 10.2**
 *
 * The Tree-Sitter runtime + Java grammar are loaded once via
 * {@link createAstExtractor}; extraction is driven from in-memory sources via an
 * injected {@link AstExtractorDeps.readFile}, so no real `.java` files are
 * written to disk.
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import type { GraphNode } from "@repohive/shared";
import {
  createAstExtractor,
  type AstExtractor,
  type AstExtractorDeps,
} from "./ast-extractor.js";
import { ParseErrorCollector } from "./errors.js";
import type { CollectedFile, ExtractionResult } from "./types.js";

// --------------------------------------------------------------------------
// Shared extractor + helpers.
// --------------------------------------------------------------------------

/**
 * A single shared extractor: the Tree-Sitter runtime is expensive to initialize
 * and the grammar is stateless per parse, so one instance serves every test.
 */
let extractor: AstExtractor;

before(async () => {
  extractor = await createAstExtractor();
});

/** Build injected deps whose `readFile` serves one in-memory source string. */
function sourceDeps(source: string, throwFor?: string): AstExtractorDeps {
  return {
    readFile(absolutePath) {
      if (throwFor !== undefined && absolutePath === throwFor) {
        const error = new Error("EACCES") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return source;
    },
  };
}

/** A {@link CollectedFile} with matching absolute / relative paths. */
function file(relativePath: string, absolutePath = relativePath): CollectedFile {
  return { absolutePath, relativePath };
}

/** Extract a single in-memory source, asserting the file was extracted. */
async function extractSource(
  relativePath: string,
  source: string,
): Promise<{ result: ExtractionResult; errors: ParseErrorCollector }> {
  const local = await createAstExtractor(sourceDeps(source));
  const errors = new ParseErrorCollector();
  const result = local.extract(file(relativePath), errors);
  assert.notEqual(result, null, "expected the file to be extracted");
  return { result: result!, errors };
}

function idsOfKind(nodes: readonly GraphNode[], kind: GraphNode["kind"]): string[] {
  return nodes.filter((n) => n.kind === kind).map((n) => n.id);
}

// --------------------------------------------------------------------------
// Node extraction — file / class / function.
// --------------------------------------------------------------------------

test("emits exactly one file node carrying package and directory", async () => {
  const source = `package com.example.service;
class UserService {}`;
  const { result } = await extractSource(
    "src/com/example/service/UserService.java",
    source,
  );

  const fileNodes = result.nodes.filter((n) => n.kind === "file");
  assert.equal(fileNodes.length, 1);
  const fileNode = fileNodes[0]!;
  assert.equal(fileNode.id, "file:src/com/example/service/UserService.java");
  assert.equal(fileNode.packagePath, "com.example.service");
  assert.equal(fileNode.directoryPath, "src/com/example/service");
  // File nodes never carry definedInFile.
  assert.equal(fileNode.definedInFile, undefined);
  assert.equal(result.packagePath, "com.example.service");
});

test("emits a class node for each class / interface / enum / record", async () => {
  const source = `package com.example;
class AClass {}
interface AnInterface {}
enum AnEnum { X, Y }
record ARecord(int value) {}`;
  const { result } = await extractSource("src/com/example/Types.java", source);

  const classIds = idsOfKind(result.nodes, "class").sort();
  assert.deepEqual(classIds, [
    "class:com.example.AClass",
    "class:com.example.AnEnum",
    "class:com.example.AnInterface",
    "class:com.example.ARecord",
  ].sort());

  // Every class node carries the file's package/dir and points at the file.
  const fileId = "file:src/com/example/Types.java";
  for (const node of result.nodes.filter((n) => n.kind === "class")) {
    assert.equal(node.packagePath, "com.example");
    assert.equal(node.directoryPath, "src/com/example");
    assert.equal(node.definedInFile, fileId);
  }
});

test("emits class nodes for nested and inner types with $ separators", async () => {
  const source = `package com.example;
class Outer {
  class Inner {}
  static class Nested {
    interface Deep {}
  }
}`;
  const { result } = await extractSource("src/com/example/Outer.java", source);

  const classIds = idsOfKind(result.nodes, "class").sort();
  assert.deepEqual(classIds, [
    "class:com.example.Outer",
    "class:com.example.Outer$Inner",
    "class:com.example.Outer$Nested",
    "class:com.example.Outer$Nested$Deep",
  ].sort());
});

test("emits one function node per overload, distinguished by parameter types", async () => {
  const source = `package com.example;
class Calc {
  int add() { return 0; }
  int add(int a) { return a; }
  int add(int a, int b) { return a + b; }
  int add(long a) { return 0; }
}`;
  const { result } = await extractSource("src/com/example/Calc.java", source);

  const funcIds = idsOfKind(result.nodes, "function").sort();
  assert.deepEqual(funcIds, [
    "func:com.example.Calc#add()",
    "func:com.example.Calc#add(int)",
    "func:com.example.Calc#add(int,int)",
    "func:com.example.Calc#add(long)",
  ].sort());
});

test("emits a function node for a constructor", async () => {
  const source = `package com.example;
class User {
  User(String name) {}
}`;
  const { result } = await extractSource("src/com/example/User.java", source);

  const funcIds = idsOfKind(result.nodes, "function");
  assert.ok(funcIds.includes("func:com.example.User#User(String)"));
});

// --------------------------------------------------------------------------
// Default package (R3.8) and root file (R3.6).
// --------------------------------------------------------------------------

test("default package: nodes omit packagePath", async () => {
  const source = `class Root {
  void go() {}
}`;
  const { result } = await extractSource("Root.java", source);

  assert.equal(result.packagePath, "");
  for (const node of result.nodes) {
    assert.equal(
      node.packagePath,
      undefined,
      `node ${node.id} should omit packagePath`,
    );
  }
  // FQN forms drop the package segment entirely.
  assert.ok(idsOfKind(result.nodes, "class").includes("class:Root"));
  assert.ok(idsOfKind(result.nodes, "function").includes("func:Root#go()"));
});

test("root-level file: directoryPath is the empty string", async () => {
  const source = `class Root {}`;
  const { result } = await extractSource("Root.java", source);

  for (const node of result.nodes) {
    assert.equal(node.directoryPath, "");
  }
});

// --------------------------------------------------------------------------
// Raw import references (R3.1 → R5).
// --------------------------------------------------------------------------

test("collects one file-scoped import reference per import declaration", async () => {
  const source = `package com.example;
import com.example.model.User;
import static com.example.util.Helpers.now;
class Service {}`;
  const { result } = await extractSource("src/com/example/Service.java", source);

  const fileId = "file:src/com/example/Service.java";
  assert.deepEqual(result.references, [
    { fromNodeId: fileId, targetName: "com.example.model.User", kind: "import" },
    { fromNodeId: fileId, targetName: "com.example.util.Helpers.now", kind: "import" },
  ]);
});

test("preserves the trailing .* of a wildcard import", async () => {
  const source = `package com.example;
import com.example.model.*;
class Service {}`;
  const { result } = await extractSource("src/com/example/Service.java", source);

  assert.equal(result.references.length, 1);
  assert.equal(result.references[0]!.targetName, "com.example.model.*");
  assert.equal(result.references[0]!.kind, "import");
});

test("a file with no imports collects no references", async () => {
  const source = `package com.example;
class Service {}`;
  const { result } = await extractSource("src/com/example/Service.java", source);
  assert.deepEqual(result.references, []);
});

// --------------------------------------------------------------------------
// Per-file error handling (R10.1, R10.2) — continuation with remaining files.
// --------------------------------------------------------------------------

test("records file-unreadable and returns null when the file cannot be read", async () => {
  const unreadable = "src/Bad.java";
  const local = await createAstExtractor(sourceDeps("class X {}", unreadable));
  const errors = new ParseErrorCollector();

  const result = local.extract(file(unreadable, unreadable), errors);

  assert.equal(result, null);
  assert.equal(errors.hasErrors(), true);
  const recorded = errors.errors();
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.reason, "file-unreadable");
  assert.equal(recorded[0]!.path, unreadable);
});

test("records file-unparseable and returns null for syntactically invalid Java", async () => {
  // A class with an unterminated body / stray tokens the grammar cannot resolve
  // into valid declarations; Tree-Sitter marks the tree with ERROR nodes.
  const source = `package com.example;
class Broken {
  void m( {
`;
  const local = await createAstExtractor(sourceDeps(source));
  const errors = new ParseErrorCollector();

  const result = local.extract(file("src/com/example/Broken.java"), errors);

  assert.equal(result, null);
  assert.equal(errors.hasErrors(), true);
  const recorded = errors.errors();
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.reason, "file-unparseable");
  assert.equal(recorded[0]!.path, "src/com/example/Broken.java");
});

test("continues extracting remaining files after an unparseable file", async () => {
  const broken = "src/Broken.java";
  const good = "src/Good.java";
  const sources: Record<string, string> = {
    [broken]: "class Broken { void m( {",
    [good]: "package com.example;\nclass Good {}",
  };
  const deps: AstExtractorDeps = {
    readFile: (absolutePath) => sources[absolutePath]!,
  };
  const local = await createAstExtractor(deps);
  const errors = new ParseErrorCollector();

  // Process the broken file first, then the good one — mirrors the
  // orchestrator's canonical-order loop.
  const brokenResult = local.extract(file(broken, broken), errors);
  const goodResult = local.extract(file(good, good), errors);

  assert.equal(brokenResult, null);
  assert.notEqual(goodResult, null);
  assert.ok(
    idsOfKind(goodResult!.nodes, "class").includes("class:com.example.Good"),
  );
  // The broken file was recorded but did not stop extraction of the good file.
  assert.equal(errors.errors().length, 1);
  assert.equal(errors.errors()[0]!.reason, "file-unparseable");
});

// --------------------------------------------------------------------------
// Property: every node carries the file's package/dir; class/function nodes
// reference the file node (R3.7, R3.9).
// --------------------------------------------------------------------------

test("every class/function node references the file and shares its package/dir", async () => {
  const ident = fc.constantFrom("Foo", "Bar", "Baz", "Svc", "Model", "Util");
  const pkgSegment = fc.constantFrom("com", "org", "example", "app", "core");

  await fc.assert(
    fc.asyncProperty(
      fc.array(pkgSegment, { minLength: 0, maxLength: 3 }),
      fc.uniqueArray(ident, { minLength: 1, maxLength: 4 }),
      async (pkgSegments, classNames) => {
        const pkg = pkgSegments.join(".");
        const dir = pkgSegments.length > 0 ? `src/${pkgSegments.join("/")}` : "src";
        const rel = `${dir}/File.java`;

        const packageLine = pkg.length > 0 ? `package ${pkg};\n` : "";
        const body = classNames
          .map((name) => `class ${name} { void run() {} }`)
          .join("\n");
        const source = packageLine + body;

        const local = await createAstExtractor(sourceDeps(source));
        const errors = new ParseErrorCollector();
        const result = local.extract(file(rel), errors);

        assert.equal(errors.hasErrors(), false);
        assert.notEqual(result, null);
        const nodes = result!.nodes;

        const fileNodes = nodes.filter((n) => n.kind === "file");
        assert.equal(fileNodes.length, 1);
        const fileId = fileNodes[0]!.id;

        for (const node of nodes) {
          assert.equal(node.directoryPath, dir);
          if (pkg.length > 0) {
            assert.equal(node.packagePath, pkg);
          } else {
            assert.equal(node.packagePath, undefined);
          }
          if (node.kind === "file") {
            assert.equal(node.definedInFile, undefined);
          } else {
            assert.equal(node.definedInFile, fileId);
          }
        }

        // One class node per declared class, plus one run() per class.
        assert.equal(idsOfKind(nodes, "class").length, classNames.length);
        assert.equal(idsOfKind(nodes, "function").length, classNames.length);
      },
    ),
    { numRuns: 50 },
  );
});
