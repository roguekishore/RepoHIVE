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
