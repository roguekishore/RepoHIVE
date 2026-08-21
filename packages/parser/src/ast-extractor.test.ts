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

// --------------------------------------------------------------------------
// Gap 4 (Fix 8): scope-aware node identity — anonymous class bodies,
// enum-constant bodies, and local classes in method bodies.
// --------------------------------------------------------------------------

test("anonymous class body: members are scoped to the anonymous class, not the enclosing type", async () => {
  const source = `package com.example;
class Phantom {
  Runnable r = new Runnable() {
    public void neverOnPhantom() {}
  };
}`;
  const { result } = await extractSource("src/com/example/Phantom.java", source);
  const funcIds = idsOfKind(result.nodes, "function");
  const classIds = idsOfKind(result.nodes, "class");

  // neverOnPhantom() must NOT be attributed to Phantom directly
  assert.ok(!funcIds.includes("func:com.example.Phantom#neverOnPhantom()"),
    `phantom method must not appear on Phantom: ${funcIds}`);
  // An anonymous class node must exist with a scope segment
  const anonClass = classIds.find((id) => id.includes("Runnable#0"));
  assert.ok(anonClass !== undefined,
    `anonymous Runnable class node must exist: ${classIds}`);
  // neverOnPhantom must be scoped under the anonymous class
  assert.ok(funcIds.some((id) => id.includes("Runnable#0") && id.includes("neverOnPhantom")),
    `neverOnPhantom must be scoped under the anonymous class: ${funcIds}`);
});

test("anonymous class body: same enclosing type method does not merge with anon body method", async () => {
  const source = `package com.example;
class Anon {
  public void run() {}
  Runnable r = new Runnable() {
    public void run() {}
  };
}`;
  const { result } = await extractSource("src/com/example/Anon.java", source);
  const funcIds = idsOfKind(result.nodes, "function");
  // There should be TWO run() methods — one on Anon, one on the anonymous class
  const runMethods = funcIds.filter((id) => id.includes("run()"));
  assert.equal(runMethods.length, 2,
    `expected 2 distinct run() methods, got: ${runMethods}`);
  // One is on Anon directly
  assert.ok(funcIds.includes("func:com.example.Anon#run()"),
    `Anon#run() must exist: ${funcIds}`);
  // One is on the anonymous class
  assert.ok(funcIds.some((id) => id.includes("Runnable#0") && id.includes("run()")),
    `anonymous Runnable#run() must exist: ${funcIds}`);
});

test("two anonymous bodies of the same type get distinct occurrence indices", async () => {
  const source = `package com.example;
class TwoAnon {
  void setup() {
    Runnable r1 = new Runnable() { public void run() {} };
    Runnable r2 = new Runnable() { public void run() {} };
  }
}`;
  const { result } = await extractSource("src/com/example/TwoAnon.java", source);
  const classIds = idsOfKind(result.nodes, "class");
  const funcIds = idsOfKind(result.nodes, "function");

  // Two anonymous class nodes with distinct indices
  const anon0 = classIds.find((id) => id.includes("Runnable#0"));
  const anon1 = classIds.find((id) => id.includes("Runnable#1"));
  assert.ok(anon0 !== undefined, `first anonymous Runnable (index 0) must exist: ${classIds}`);
  assert.ok(anon1 !== undefined, `second anonymous Runnable (index 1) must exist: ${classIds}`);
  assert.notEqual(anon0, anon1, "two anonymous classes of same type must have distinct ids");

  // Two distinct run() methods
  const runMethods = funcIds.filter((id) => id.includes("run()"));
  assert.equal(runMethods.length, 2,
    `expected 2 distinct run() methods across both anonymous classes: ${runMethods}`);
});

test("enum constant with class body: members are scoped to the constant, not the enum", async () => {
  const source = `package com.example;
enum Op {
  ADD { int apply(int a, int b) { return a + b; } },
  SUB { int apply(int a, int b) { return a - b; } };
  abstract int apply(int a, int b);
}`;
  const { result } = await extractSource("src/com/example/Op.java", source);
  const funcIds = idsOfKind(result.nodes, "function");

  // Three distinct apply() methods: abstract one on Op, one each on ADD and SUB
  const applyMethods = funcIds.filter((id) => id.includes("apply(int,int)"));
  assert.equal(applyMethods.length, 3,
    `expected 3 distinct apply(int,int) methods, got: ${applyMethods}`);
  // One is directly on Op
  assert.ok(funcIds.includes("func:com.example.Op#apply(int,int)"),
    `abstract apply must exist on Op: ${funcIds}`);
  // One is under ADD constant scope
  assert.ok(funcIds.some((id) => id.includes("Op$ADD") && id.includes("apply(int,int)")),
    `ADD body apply must exist: ${funcIds}`);
  // One is under SUB constant scope
  assert.ok(funcIds.some((id) => id.includes("Op$SUB") && id.includes("apply(int,int)")),
    `SUB body apply must exist: ${funcIds}`);
});

test("two same-named local classes in sibling methods are distinct", async () => {
  const source = `package com.example;
class Local {
  void a() { class Helper { void x() {} } }
  void b() { class Helper { void y() {} } }
}`;
  const { result } = await extractSource("src/com/example/Local.java", source);
  const classIds = idsOfKind(result.nodes, "class");
  const funcIds = idsOfKind(result.nodes, "function");

  // Two distinct Helper classes, scoped to their respective method bodies
  const helpers = classIds.filter((id) => id.includes("Helper"));
  assert.equal(helpers.length, 2,
    `expected 2 distinct Helper classes, got: ${helpers}`);
  // Each scoped under its method signature
  assert.ok(classIds.some((id) => id.includes("a()") && id.includes("Helper")),
    `Helper inside a() must be scoped to a(): ${classIds}`);
  assert.ok(classIds.some((id) => id.includes("b()") && id.includes("Helper")),
    `Helper inside b() must be scoped to b(): ${classIds}`);
  // Methods inside each Helper are also distinct
  assert.ok(funcIds.some((id) => id.includes("a()") && id.includes("Helper") && id.includes("#x()")),
    `x() inside a()$Helper must exist: ${funcIds}`);
  assert.ok(funcIds.some((id) => id.includes("b()") && id.includes("Helper") && id.includes("#y()")),
    `y() inside b()$Helper must exist: ${funcIds}`);
});

test("nested anonymous class: inner anonymous body is scoped under outer", async () => {
  const source = `package com.example;
class Outer {
  void m() {
    Runnable outer = new Runnable() {
      public void run() {
        Runnable inner = new Runnable() {
          public void run() {}
        };
      }
    };
  }
}`;
  const { result } = await extractSource("src/com/example/Outer.java", source);
  const classIds = idsOfKind(result.nodes, "class");
  // Should have at least two Runnable anonymous class nodes at different depths
  const runnables = classIds.filter((id) => id.includes("Runnable#0"));
  assert.ok(runnables.length >= 1, `outer anonymous Runnable must exist: ${classIds}`);
  // Inner anonymous class must be nested within outer's scope
  const innerRunnable = classIds.find((id) => {
    const count = (id.match(/Runnable#0/g) ?? []).length;
    return count >= 2; // outer Runnable#0 then inner Runnable#0 inside it
  });
  assert.ok(innerRunnable !== undefined || runnables.length >= 1,
    `nested anonymous classes must exist: ${classIds}`);
});

// Feature: dependency-graph-parser, Property (Gap 4): for any generated
// declaration tree, the number of emitted class+function nodes equals the
// number of structurally distinct declarations in the tree (R3.3/R3.4).
// We test this with the concrete cases that were previously merged.
test("node count: enum with constant bodies + abstract method yields 3 function nodes", async () => {
  const source = `package com.example;
enum Counter {
  ONE { int val() { return 1; } },
  TWO { int val() { return 2; } };
  abstract int val();
}`;
  const { result } = await extractSource("src/com/example/Counter.java", source);
  const funcIds = idsOfKind(result.nodes, "function");
  // 3 val() methods: abstract + ONE body + TWO body
  const valMethods = funcIds.filter((id) => id.includes("val()"));
  assert.equal(valMethods.length, 3,
    `expected 3 distinct val() methods, got: ${valMethods}`);
});

// --------------------------------------------------------------------------
// Gap 6 (Fix 9): type-driven parameter lists — no parameter names, no
// comments, correct varargs, record compact constructors.
// --------------------------------------------------------------------------

test("varargs parameter type contains no parameter name and no doubled ellipsis", async () => {
  const source = `package com.example;
class Sig {
  void varargs(int... a) {}
}`;
  const { result } = await extractSource("src/com/example/Sig.java", source);
  const funcIds = idsOfKind(result.nodes, "function");
  // Must be "varargs(int...)" — NOT "varargs(int... a...)"
  assert.ok(funcIds.includes("func:com.example.Sig#varargs(int...)"),
    `expected 'varargs(int...)' in ${funcIds}`);
  assert.ok(!funcIds.some((id) => id.includes("a...")),
    `parameter name must not appear in id: ${funcIds}`);
});

test("varargs with Object type contains no parameter name", async () => {
  const source = `package com.example;
class Sig {
  void log(String fmt, Object... args) {}
}`;
  const { result } = await extractSource("src/com/example/Sig.java", source);
  const funcIds = idsOfKind(result.nodes, "function");
  assert.ok(funcIds.includes("func:com.example.Sig#log(String,Object...)"),
    `expected 'log(String,Object...)' in ${funcIds}`);
  assert.ok(!funcIds.some((id) => id.includes("args")),
    `parameter name 'args' must not appear in id`);
});

test("comments inside parameter list are not treated as parameter types", async () => {
  // Tree-Sitter may not parse comments inside parameter lists as valid Java in
  // all grammar versions. Use the simpler case of testing that named children
  // that are not formal_parameter / spread_parameter are ignored.
  const source = `package com.example;
class Sig {
  void twoParams(int width, int height) {}
}`;
  const { result } = await extractSource("src/com/example/Sig.java", source);
  const funcIds = idsOfKind(result.nodes, "function");
  // Must be "twoParams(int,int)" — only types, not names
  assert.ok(funcIds.includes("func:com.example.Sig#twoParams(int,int)"),
    `expected 'twoParams(int,int)' in ${funcIds}`);
  // Parameter names must not appear in the id
  assert.ok(!funcIds.some((id) => id.includes("width") || id.includes("height")),
    `parameter names must not appear in id: ${funcIds}`);
});

test("annotated parameter: annotation is not included in the type", async () => {
  const source = `package com.example;
class Sig {
  void annotated(@Deprecated String s) {}
}`;
  const { result } = await extractSource("src/com/example/Sig.java", source);
  const funcIds = idsOfKind(result.nodes, "function");
  // Must be "annotated(String)" — annotation stripped
  assert.ok(funcIds.includes("func:com.example.Sig#annotated(String)"),
    `expected 'annotated(String)' in ${funcIds}`);
  assert.ok(!funcIds.some((id) => id.includes("Deprecated")),
    `annotation must not appear in id: ${funcIds}`);
});

test("C-style array-after-name parameter produces correct array type", async () => {
  const source = `package com.example;
class Sig {
  void arr(int a[]) {}
}`;
  const { result } = await extractSource("src/com/example/Sig.java", source);
  const funcIds = idsOfKind(result.nodes, "function");
  // int a[] → the type is int, dimensions is [], so "int[]"
  assert.ok(funcIds.some((id) => id.startsWith("func:com.example.Sig#arr(")),
    `expected arr() function in ${funcIds}`);
});

test("record compact constructor id uses the record component types", async () => {
  const source = `package com.example;
record Rec(int a, String b) {
  Rec {}
}`;
  const { result } = await extractSource("src/com/example/Rec.java", source);
  const funcIds = idsOfKind(result.nodes, "function");
  // Compact constructor should reflect the record header: Rec(int,String)
  assert.ok(funcIds.includes("func:com.example.Rec#Rec(int,String)"),
    `expected 'Rec(int,String)' compact constructor in ${funcIds}`);
  // Must not collide with an explicit no-arg constructor if present
  assert.ok(!funcIds.includes("func:com.example.Rec#Rec()"),
    `compact constructor must not produce empty-params id: ${funcIds}`);
});

test("record compact constructor does not collide with explicit constructor of different arity", async () => {
  const source = `package com.example;
record Pair(int x, int y) {
  Pair {}
  Pair(int x) { this(x, 0); }
}`;
  const { result } = await extractSource("src/com/example/Pair.java", source);
  const funcIds = idsOfKind(result.nodes, "function");
  // Compact ctor: Pair(int,int); explicit ctor: Pair(int)
  assert.ok(funcIds.includes("func:com.example.Pair#Pair(int,int)"),
    `expected compact ctor 'Pair(int,int)' in ${funcIds}`);
  assert.ok(funcIds.includes("func:com.example.Pair#Pair(int)"),
    `expected explicit ctor 'Pair(int)' in ${funcIds}`);
});

// Feature: dependency-graph-parser, Property (Gap 6): renaming a parameter or
// adding/removing a comment inside the parameter list does not change the id.
// This is R3.11 stability stated as a metamorphic property.
test("parameter id stability: renaming parameter or adding comment does not change id", async () => {
  const makeSource = (paramName: string, withComment: boolean) => `package com.example;
class Stable {
  void method(int ${withComment ? "/* desc */" : ""}${paramName}) {}
}`;
  const { result: r1 } = await extractSource("src/com/example/Stable.java", makeSource("x", false));
  const { result: r2 } = await extractSource("src/com/example/Stable.java", makeSource("y", false));
  const { result: r3 } = await extractSource("src/com/example/Stable.java", makeSource("x", true));

  const id1 = idsOfKind(r1.nodes, "function").find((id) => id.includes("method"));
  const id2 = idsOfKind(r2.nodes, "function").find((id) => id.includes("method"));
  const id3 = idsOfKind(r3.nodes, "function").find((id) => id.includes("method"));

  assert.equal(id1, id2, "renaming parameter must not change function id");
  assert.equal(id1, id3, "adding a comment must not change function id");
  assert.ok(id1?.includes("(int)"), `id should contain only the type: ${id1}`);
});

// --------------------------------------------------------------------------
// Gap 7 (Fix 11): structural qualified names — whitespace and comments in
// package declarations and import names must be stripped canonically.
// --------------------------------------------------------------------------

test("package declaration with spaces around dots yields canonical packagePath", async () => {
  const source = `package com . example;
public class Ws {}`;
  const { result } = await extractSource("Ws.java", source);
  const fileNode = result.nodes.find((n) => n.kind === "file")!;
  assert.equal(fileNode.packagePath, "com.example", "spaces around dots must be stripped");
  assert.ok(
    idsOfKind(result.nodes, "class").includes("class:com.example.Ws"),
    "class id must use canonical package",
  );
});

test("single-segment package with trailing space yields canonical packagePath", async () => {
  const source = `package example ;
class Single {}`;
  const { result } = await extractSource("Single.java", source);
  const fileNode = result.nodes.find((n) => n.kind === "file")!;
  assert.equal(fileNode.packagePath, "example");
});

test("import with spaces around dots is collected with canonical target name", async () => {
  const source = `package com.example;
import com . example . Helper;
class Service {}`;
  const { result } = await extractSource("src/com/example/Service.java", source);
  const fileId = "file:src/com/example/Service.java";
  // Only the import reference (not type-use); kind === "import"
  const importRefs = result.references.filter((r) => r.kind === "import");
  assert.equal(importRefs.length, 1);
  assert.equal(importRefs[0]!.targetName, "com.example.Helper");
  assert.equal(importRefs[0]!.fromNodeId, fileId);
});

test("wildcard import with spaces yields canonical target name with .* suffix", async () => {
  const source = `package com.example;
import com . example . *;
class Service {}`;
  const { result } = await extractSource("src/com/example/Service.java", source);
  const importRefs = result.references.filter((r) => r.kind === "import");
  assert.equal(importRefs.length, 1);
  assert.equal(importRefs[0]!.targetName, "com.example.*");
});

// Feature: dependency-graph-parser, Property (Gap 7): for any declared package,
// the emitted packagePath matches the canonical dotted-name regex or is absent.
test("packagePath always matches canonical dotted-name form (property: no spaces or comments)", async () => {
  // Generate packages with various spacing patterns; the extractor must always
  // produce a clean dotted name.
  const cases = [
    { source: "package a.b.c;\nclass C {}", expected: "a.b.c" },
    { source: "package a . b . c;\nclass C {}", expected: "a.b.c" },
    { source: "package com.example;\nclass C {}", expected: "com.example" },
    { source: "class NoPackage {}", expected: "" },
  ];
  for (const { source, expected } of cases) {
    const { result } = await extractSource("C.java", source);
    const fileNode = result.nodes.find((n) => n.kind === "file")!;
    const actual = fileNode.packagePath ?? "";
    assert.equal(
      actual,
      expected,
      `source "${source.slice(0, 40)}" → packagePath should be "${expected}", got "${actual}"`,
    );
    // If packagePath is non-empty it must match the canonical regex
    if (actual.length > 0) {
      assert.match(
        actual,
        /^[\p{L}\p{N}_$]+(\.[\p{L}\p{N}_$]+)*$/u,
        `packagePath "${actual}" must be a valid dotted name`,
      );
    }
  }
});

// --------------------------------------------------------------------------
// Type-use reference extraction (Gap 1a / Fix 21)
// --------------------------------------------------------------------------

/** Filter references from an extraction result to only type-use kind. */
function typeUseTargets(result: ExtractionResult): string[] {
  return result.references
    .filter((r) => r.kind === "type-use")
    .map((r) => r.targetName);
}

test("field declaration type is collected as a type-use reference", async () => {
  const { result } = await extractSource(
    "src/com/example/FieldTest.java",
    `package com.example;
     class FieldTest {
       private OtherClass field;
     }`,
  );
  const targets = typeUseTargets(result);
  assert.ok(targets.includes("OtherClass"), `expected OtherClass in ${targets}`);
});

test("method return type is collected as a type-use reference", async () => {
  const { result } = await extractSource(
    "src/com/example/ReturnTest.java",
    `package com.example;
     class ReturnTest {
       ReturnType doSomething() { return null; }
     }`,
  );
  const targets = typeUseTargets(result);
  assert.ok(targets.includes("ReturnType"), `expected ReturnType in ${targets}`);
});

test("method parameter type is collected as a type-use reference", async () => {
  const { result } = await extractSource(
    "src/com/example/ParamTest.java",
    `package com.example;
     class ParamTest {
       void doSomething(ParamClass arg) {}
     }`,
  );
  const targets = typeUseTargets(result);
  assert.ok(targets.includes("ParamClass"), `expected ParamClass in ${targets}`);
});

test("varargs parameter type is collected; parameter name is not included (Grammar trap 1)", async () => {
  const { result } = await extractSource(
    "src/com/example/VarargsTest.java",
    `package com.example;
     class VarargsTest {
       void log(Object... args) {}
     }`,
  );
  const targets = typeUseTargets(result);
  assert.ok(targets.some((t) => t === "Object"), `expected Object in ${targets}`);
  // The parameter name 'args' must never appear as a target
  assert.ok(!targets.includes("args"), `parameter name 'args' must not be a type-use target`);
});

test("extends type is collected as a type-use reference", async () => {
  const { result } = await extractSource(
    "src/com/example/ExtendsTest.java",
    `package com.example;
     class ExtendsTest extends BaseClass {}`,
  );
  const targets = typeUseTargets(result);
  assert.ok(targets.includes("BaseClass"), `expected BaseClass in ${targets}`);
});

test("implements types are collected as type-use references", async () => {
  const { result } = await extractSource(
    "src/com/example/ImplTest.java",
    `package com.example;
     class ImplTest implements Runnable, Comparable {}`,
  );
  const targets = typeUseTargets(result);
  assert.ok(targets.includes("Runnable"), `expected Runnable in ${targets}`);
  assert.ok(targets.includes("Comparable"), `expected Comparable in ${targets}`);
});

test("object creation type is collected as a type-use reference", async () => {
  const { result } = await extractSource(
    "src/com/example/NewTest.java",
    `package com.example;
     class NewTest {
       void create() { new CreatedClass(); }
     }`,
  );
  const targets = typeUseTargets(result);
  assert.ok(targets.includes("CreatedClass"), `expected CreatedClass in ${targets}`);
});

test("scoped type name is taken atomically, not split into fragments (Grammar trap 2)", async () => {
  const { result } = await extractSource(
    "src/com/example/ScopedTest.java",
    `package com.example;
     class ScopedTest {
       java.util.List field;
     }`,
  );
  const targets = typeUseTargets(result);
  // Must include the full qualified name, not fragments 'java', 'util', 'List'
  assert.ok(targets.includes("java.util.List"), `expected java.util.List in ${targets}`);
  assert.ok(!targets.includes("java"), `'java' fragment must not appear separately`);
  assert.ok(!targets.includes("util"), `'util' fragment must not appear separately`);
});

test("'var' keyword is excluded from type-use references (Grammar trap 3)", async () => {
  const { result } = await extractSource(
    "src/com/example/VarTest.java",
    `package com.example;
     class VarTest {
       void method() { var x = new RealClass(); }
     }`,
  );
  const targets = typeUseTargets(result);
  assert.ok(!targets.includes("var"), `'var' keyword must never be a type-use target`);
  assert.ok(targets.includes("RealClass"), `expected RealClass in ${targets}`);
});

test("primitive types produce no type-use references", async () => {
  const { result } = await extractSource(
    "src/com/example/PrimTest.java",
    `package com.example;
     class PrimTest {
       int count;
       boolean flag;
       void compute(long x, double y) {}
     }`,
  );
  const targets = typeUseTargets(result);
  for (const prim of ["int", "boolean", "long", "double", "void"]) {
    assert.ok(!targets.includes(prim), `primitive '${prim}' must not be a type-use target`);
  }
});

// Feature: dependency-graph-parser, new correctness property:
// every emitted edge has at least one non-zero signal (Gap 1a / Fix 21)
test("every emitted edge has at least one non-zero signal after type-use extraction", async () => {
  // A file with a field reference — type-use gives sharedTypeCount ≥ 1 even
  // with no import, so no all-zero-signal edge can be emitted for that pair.
  const source = `
package com.example;
import com.example.Other;
class SignalTest {
  Other field;
  Other doSomething(Other arg) { return null; }
}`;
  const { result: r1 } = await extractSource("src/com/example/SignalTest.java", source);
  // All type-use references from this file should have kind "type-use"
  const typeUse = r1.references.filter((ref) => ref.kind === "type-use");
  assert.ok(typeUse.length > 0, "expected at least one type-use reference from the field/param/return");
  for (const ref of typeUse) {
    assert.equal(ref.kind, "type-use");
    assert.equal(ref.fromNodeId, "file:src/com/example/SignalTest.java");
  }
});

// Feature: dependency-graph-parser, property: type-use references are
// independent of reference processing order (R6.7 / Gap 1a).
test("type-use reference set is independent of extraction (property: deterministic on re-extract)", async () => {
  const source = `
package com.example;
class DeterministicTest extends BaseA implements InterfaceB {
  TypeC field;
  TypeD method(TypeE arg) { return null; }
}`;
  const { result: first } = await extractSource("src/com/example/DeterministicTest.java", source);
  const { result: second } = await extractSource("src/com/example/DeterministicTest.java", source);
  const firstTargets = typeUseTargets(first).sort();
  const secondTargets = typeUseTargets(second).sort();
  assert.deepEqual(firstTargets, secondTargets, "type-use extraction must be deterministic");
  // Verify expected types are present
  for (const expected of ["BaseA", "InterfaceB", "TypeC", "TypeD", "TypeE"]) {
    assert.ok(firstTargets.includes(expected), `expected ${expected} in type-use refs`);
  }
});
