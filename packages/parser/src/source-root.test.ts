/**
 * Tests for source-root derivation (source-root.ts).
 *
 * Covers Fix 24 — Gap 2: identity and resolution are scoped by source root,
 * derived purely from the package↔directory correspondence. These tests pin
 * every row of the derivation table and the degenerate fallback, plus the
 * purity property that a stable id can rely on (R3.10, R3.11).
 *
 * **Validates: Requirements 3.7, 3.10, 3.11 (source-root scoping, Fix 24)**
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { deriveSourceRoot } from "./source-root.js";

// ---------------------------------------------------------------------------
// Example-based unit tests — one per row of the derivation table.
// ---------------------------------------------------------------------------

test("standard Maven layout: strips the package tail to leave the source root", () => {
  assert.equal(
    deriveSourceRoot("src/main/java/com/example/Foo.java", "com.example"),
    "src/main/java",
  );
});

test("test source root is distinct from the main source root", () => {
  assert.equal(
    deriveSourceRoot("core/mod/src/test/java/com/example/Foo.java", "com.example"),
    "core/mod/src/test/java",
  );
  assert.equal(
    deriveSourceRoot("core/mod/src/main/java/com/example/Foo.java", "com.example"),
    "core/mod/src/main/java",
  );
});

test("two modules sharing an FQN derive distinct source roots", () => {
  const a = deriveSourceRoot(
    "core/broadleaf-framework/src/test/java/org/b/OfferServiceTest.java",
    "org.b",
  );
  const b = deriveSourceRoot(
    "integration/src/test/java/org/b/OfferServiceTest.java",
    "org.b",
  );
  assert.notEqual(a, b);
  assert.equal(a, "core/broadleaf-framework/src/test/java");
  assert.equal(b, "integration/src/test/java");
});

test("file sitting directly at the source root yields an empty scope", () => {
  assert.equal(deriveSourceRoot("com/example/Foo.java", "com.example"), "");
});

test("default package: the source root is the file's own directory", () => {
  assert.equal(deriveSourceRoot("loose/Bar.java", ""), "loose");
});

test("default package at the repository root yields an empty scope", () => {
  assert.equal(deriveSourceRoot("Baz.java", ""), "");
});

test("degenerate: package not matching the directory tail falls back to the full path", () => {
  assert.equal(
    deriveSourceRoot("weird/place/Foo.java", "com.example"),
    "weird/place/Foo.java",
  );
});

test("single-segment package strips one directory level", () => {
  assert.equal(deriveSourceRoot("src/app/Main.java", "app"), "src");
});

// ---------------------------------------------------------------------------
// Property — purity/determinism: deriveSourceRoot is a pure function of its
// inputs (no clock/counter/randomness), so it never varies across calls, and
// never emits host-path material (backslashes) that its POSIX input lacks.
// ---------------------------------------------------------------------------

const segment = fc.constantFrom("a", "b", "com", "example", "src", "main", "java", "test", "mod");
const posixDir = fc.array(segment, { minLength: 0, maxLength: 6 }).map((s) => s.join("/"));
const pkg = fc.array(segment, { minLength: 0, maxLength: 4 }).map((s) => s.join("."));

// Feature: dependency-graph-parser, Property (Fix 24 — Gap 2): source-root
// derivation is a pure function of (relativePath, packagePath) and introduces
// no host-path material.
test("property: deriveSourceRoot is pure and POSIX-clean", () => {
  fc.assert(
    fc.property(posixDir, segment, pkg, (dir, file, packagePath) => {
      const rel = (dir.length > 0 ? dir + "/" : "") + file + ".java";
      const once = deriveSourceRoot(rel, packagePath);
      const twice = deriveSourceRoot(rel, packagePath);
      assert.equal(once, twice);
      assert.ok(!once.includes("\\"));
      // The result is always either a prefix of the input path or the whole
      // input path (the degenerate fallback) — never invented material.
      assert.ok(rel === once || rel.startsWith(once));
    }),
    { numRuns: 200 },
  );
});
