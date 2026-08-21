/**
 * Tests for the content-derived node-ID scheme (ids.ts).
 *
 * Covers Property 2 (Content-derived, stable, unique IDs) from the design:
 * every id is a pure function of structural attributes; re-deriving the same
 * entity yields the same id (R3.11); distinct entities yield distinct ids
 * (R3.12); only forward-slash root-relative paths enter ids and no
 * counter/timestamp/random/host-path material is used (R3.10, R9.4).
 *
 * **Validates: Requirements 3.10, 3.11, 3.12, 9.4**
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  buildFileId,
  buildClassFqn,
  buildClassId,
  buildFunctionId,
  FILE_ID_PREFIX,
  CLASS_ID_PREFIX,
  FUNCTION_ID_PREFIX,
} from "./ids.js";

// ---------------------------------------------------------------------------
// Generators — structural inputs only (safe identifier tokens, no separators).
// ---------------------------------------------------------------------------

/** Java-like simple identifiers containing none of the id separators. */
const ident = fc.constantFrom(
  "a",
  "b",
  "c",
  "Foo",
  "Bar",
  "User",
  "Service",
  "Outer",
  "Inner",
  "x1",
  "y2",
  "save",
  "load",
);

/**
 * Java-like identifiers including separator characters ($ and others) —
 * widens the generator used for distinctness properties so that identifiers
 * that look like separators cannot be confused with actual separators
 * (Fix 7 — Gap 5: validates the $$ escaping).
 */
const identWithDollar = fc.constantFrom(
  "a",
  "Foo",
  "Outer",
  "Inner",
  "Outer$Inner",   // top-level class whose name contains $
  "A$B$C",         // multiple $ in name
  "$Leading",
  "Trailing$",
);

/** A dotted package path, or "" for the default package. */
const packagePath = fc
  .array(ident, { minLength: 0, maxLength: 4 })
  .map((segments) => segments.join("."));

/** A non-empty enclosing-type chain (outermost first). */
const nestedTypeNames = fc.array(ident, { minLength: 1, maxLength: 4 });

/** A forward-slash, root-relative POSIX path ending in `.java`. */
const relativeJavaPath = fc
  .array(ident, { minLength: 1, maxLength: 5 })
  .map((segments) => segments.join("/") + ".java");

/** A parameter-type list (each type an identifier or dotted FQN). */
const parameterTypes = fc.array(
  fc.array(ident, { minLength: 1, maxLength: 3 }).map((s) => s.join(".")),
  { minLength: 0, maxLength: 4 },
);

// ---------------------------------------------------------------------------
// Property 2 — stability: re-deriving the same entity yields the same id.
// ---------------------------------------------------------------------------

test("file id is a pure, stable function of its relative path", () => {
  fc.assert(
    fc.property(relativeJavaPath, (rel) => {
      assert.equal(buildFileId(rel), buildFileId(rel));
    }),
  );
});

test("class id is a pure, stable function of package + type chain", () => {
  fc.assert(
    fc.property(packagePath, nestedTypeNames, (pkg, chain) => {
      assert.equal(buildClassId(pkg, chain), buildClassId(pkg, chain));
    }),
  );
});

test("function id is a pure, stable function of its structural inputs", () => {
  fc.assert(
    fc.property(
      packagePath,
      nestedTypeNames,
      ident,
      parameterTypes,
      (pkg, chain, name, params) => {
        const fqn = buildClassFqn(pkg, chain);
        assert.equal(
          buildFunctionId(fqn, name, params),
          buildFunctionId(fqn, name, params),
        );
      },
    ),
  );
});

// ---------------------------------------------------------------------------
// Property 2 — distinctness: distinct entities yield distinct ids.
// ---------------------------------------------------------------------------

test("distinct file paths yield distinct file ids", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(relativeJavaPath, { minLength: 1, maxLength: 20 }),
      (paths) => {
        const ids = paths.map(buildFileId);
        assert.equal(new Set(ids).size, ids.length);
      },
    ),
  );
});

test("distinct class descriptors yield distinct class ids", () => {
  const classDescriptor = fc.record({ pkg: packagePath, chain: nestedTypeNames });
  fc.assert(
    fc.property(
      fc.uniqueArray(classDescriptor, {
        minLength: 1,
        maxLength: 20,
        selector: (d) => `${d.pkg}::${d.chain.join("$")}`,
      }),
      (descriptors) => {
        const ids = descriptors.map((d) => buildClassId(d.pkg, d.chain));
        assert.equal(new Set(ids).size, ids.length);
      },
    ),
  );
});

test("overloads differing only in parameter types yield distinct function ids", () => {
  const fnDescriptor = fc.record({
    name: ident,
    params: parameterTypes,
  });
  fc.assert(
    fc.property(
      packagePath,
      nestedTypeNames,
      fc.uniqueArray(fnDescriptor, {
        minLength: 1,
        maxLength: 20,
        selector: (d) => `${d.name}(${d.params.join(",")})`,
      }),
      (pkg, chain, fns) => {
        const fqn = buildClassFqn(pkg, chain);
        const ids = fns.map((f) => buildFunctionId(fqn, f.name, f.params));
        assert.equal(new Set(ids).size, ids.length);
      },
    ),
  );
});

test("the three id kinds never collide across kinds", () => {
  fc.assert(
    fc.property(
      relativeJavaPath,
      packagePath,
      nestedTypeNames,
      ident,
      parameterTypes,
      (rel, pkg, chain, name, params) => {
        const fqn = buildClassFqn(pkg, chain);
        const fileId = buildFileId(rel);
        const classId = buildClassId(pkg, chain);
        const funcId = buildFunctionId(fqn, name, params);
        assert.equal(new Set([fileId, classId, funcId]).size, 3);
      },
    ),
  );
});

// ---------------------------------------------------------------------------
// Property 2 — only structural material enters ids (R3.10, R9.4).
// ---------------------------------------------------------------------------

test("ids carry the correct prefix and no host-path material", () => {
  fc.assert(
    fc.property(relativeJavaPath, (rel) => {
      const id = buildFileId(rel);
      assert.ok(id.startsWith(FILE_ID_PREFIX));
      // No backslashes, no drive letters, no leading slash after the prefix.
      const body = id.slice(FILE_ID_PREFIX.length);
      assert.ok(!body.includes("\\"));
      assert.ok(!/^[A-Za-z]:/.test(body));
      assert.ok(!body.startsWith("/"));
    }),
  );
});

test("buildFileId rejects non-root-relative or host-specific paths (R9.4)", () => {
  assert.throws(() => buildFileId(""));
  assert.throws(() => buildFileId("C:/Users/x/A.java"));
  assert.throws(() => buildFileId("src\\com\\example\\A.java"));
  assert.throws(() => buildFileId("/abs/A.java"));
});

// ---------------------------------------------------------------------------
// Example-based unit tests — exact forms from the design table.
// ---------------------------------------------------------------------------

test("file id matches the documented form", () => {
  assert.equal(
    buildFileId("src/com/example/UserService.java"),
    "file:src/com/example/UserService.java",
  );
});

test("class id uses dotted package with the type chain", () => {
  assert.equal(
    buildClassId("com.example", ["UserService"]),
    "class:com.example.UserService",
  );
});

test("nested types use $ separators", () => {
  assert.equal(
    buildClassId("com.example", ["Outer", "Inner"]),
    "class:com.example.Outer$Inner",
  );
});

test("default-package class FQN omits the leading dot", () => {
  assert.equal(buildClassFqn("", ["Outer", "Inner"]), "Outer$Inner");
  assert.equal(buildClassId("", ["Root"]), "class:Root");
});

test("function id includes enclosing FQN, name, and parameter types", () => {
  assert.equal(
    buildFunctionId("com.example.UserService", "save", ["com.example.User"]),
    "func:com.example.UserService#save(com.example.User)",
  );
});

test("no-argument function id has empty parentheses", () => {
  assert.equal(
    buildFunctionId("com.example.UserService", "clear", []),
    "func:com.example.UserService#clear()",
  );
  assert.ok(
    buildFunctionId("com.example.UserService", "clear", []).startsWith(
      FUNCTION_ID_PREFIX,
    ),
  );
});

test("class id carries the class prefix", () => {
  assert.ok(buildClassId("com.example", ["A"]).startsWith(CLASS_ID_PREFIX));
});

// ---------------------------------------------------------------------------
// Gap 5 (Fix 7): $ escaping — a $ in an identifier segment is distinct from
// the $ separator between nested type names.
// ---------------------------------------------------------------------------

test("top-level class named 'Outer$Inner' has a distinct id from nested Outer.Inner", () => {
  // Single segment with $ in name -> escaped to $$
  const flatId = buildClassId("com.example", ["Outer$Inner"]);
  // Two segments Outer and Inner joined by $ separator
  const nestedId = buildClassId("com.example", ["Outer", "Inner"]);
  assert.notEqual(flatId, nestedId, "flat Outer$Inner must differ from nested Outer$Inner");
  // The flat one uses $$ for the escaped $
  assert.ok(flatId.includes("$$"), `flat id must contain $$ (escaped $): ${flatId}`);
  // The nested one uses a single $ as separator
  assert.equal(nestedId, "class:com.example.Outer$Inner");
  assert.equal(flatId, "class:com.example.Outer$$Inner");
});

test("multiple $ in a segment name are each doubled", () => {
  const id = buildClassId("p", ["A$B$C"]);
  assert.equal(id, "class:p.A$$B$$C");
});

test("$ at the start and end of a segment name is escaped", () => {
  const leading = buildClassId("p", ["$Leading"]);
  const trailing = buildClassId("p", ["Trailing$"]);
  assert.equal(leading, "class:p.$$Leading");
  assert.equal(trailing, "class:p.Trailing$$");
});

test("default-package class with $ in name uses $$ (no leading dot regression)", () => {
  const id = buildClassId("", ["Outer$Inner"]);
  assert.equal(id, "class:Outer$$Inner");
  assert.ok(!id.startsWith("class:."), "no leading dot for default package");
});

// ---------------------------------------------------------------------------
// Fix 24 (Gap 2): source-root scope in class/function ids.
// ---------------------------------------------------------------------------

test("empty scope leaves class and function ids unscoped (backward compatible)", () => {
  assert.equal(buildClassId("com.example", ["UserService"], ""), "class:com.example.UserService");
  assert.equal(
    buildFunctionId("com.example.UserService", "save", ["com.example.User"], ""),
    "func:com.example.UserService#save(com.example.User)",
  );
  // Omitting the arg entirely is equivalent to an empty scope.
  assert.equal(
    buildClassId("com.example", ["UserService"]),
    buildClassId("com.example", ["UserService"], ""),
  );
});

test("a non-empty scope prefixes the FQN with '<scope>|'", () => {
  assert.equal(
    buildClassId("com.example", ["UserService"], "src/test/java"),
    "class:src/test/java|com.example.UserService",
  );
  assert.equal(
    buildFunctionId("com.example.UserService", "save", ["com.example.User"], "src/test/java"),
    "func:src/test/java|com.example.UserService#save(com.example.User)",
  );
});

test("the same FQN under different source roots yields distinct ids (Gap 2)", () => {
  const core = buildClassId("org.b", ["OfferServiceTest"], "core/mod/src/test/java");
  const integ = buildClassId("org.b", ["OfferServiceTest"], "integration/src/test/java");
  assert.notEqual(core, integ);
});

test("the scope↔FQN boundary is the last '|' since an FQN never contains '|'", () => {
  const id = buildClassId("com.example", ["Outer", "Inner"], "weird/place/Foo.java");
  // The FQN portion is everything after the last '|'.
  const fqn = id.slice("class:".length).slice(id.slice("class:".length).lastIndexOf("|") + 1);
  assert.equal(fqn, "com.example.Outer$Inner");
});

// Feature: dependency-graph-parser, Property (Gap 5): for any two structurally
// distinct entities, their ids differ — even when segments contain $ characters.
// This is the single most important test: it exercises the escaping correctness
// across the separator character space.
test("distinct declarations yield distinct ids even when segments contain $ (widened distinctness)", () => {
  // Use identWithDollar to generate chains that include $ in segment names
  const chainWithDollar = fc.array(identWithDollar, { minLength: 1, maxLength: 3 });
  const classDescriptorWithDollar = fc.record({
    pkg: fc.array(ident, { minLength: 0, maxLength: 3 }).map((s) => s.join(".")),
    chain: chainWithDollar,
  });
  fc.assert(
    fc.property(
      fc.uniqueArray(classDescriptorWithDollar, {
        minLength: 1,
        maxLength: 20,
        // Two descriptors are structurally distinct when their (pkg, chain) differ
        selector: (d) => `${d.pkg}::${d.chain.join("|")}`,
      }),
      (descriptors) => {
        const ids = descriptors.map((d) => buildClassId(d.pkg, d.chain));
        assert.equal(
          new Set(ids).size,
          ids.length,
          `All ids must be distinct even with $ in segment names: ${ids}`,
        );
      },
    ),
  );
});
