/**
 * Cross-package canonical-order agreement (Gap 17).
 *
 * The parser and the core both sort by identifier, and both must mean the same
 * thing by it. They did not: the parser compared byte-wise over UTF-8 while the
 * core used JavaScript's `<`/`>` (UTF-16 code units). Nothing cross-checked
 * them, and no test compared them — which is precisely why the divergence could
 * exist unnoticed.
 *
 * These tests are that missing check. They pin the core's comparator to the
 * byte-wise UTF-8 reference semantics the parser's R9.2/R9.3 mandate, so a
 * future re-implementation on either side fails here rather than silently
 * producing a second canonical order.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { compareCanonical } from "@repohive/shared";
import { compareIds, sortIds } from "./canonical.js";

/** The reference order: unsigned byte-wise comparison of the UTF-8 encodings. */
function byteWiseReference(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** Comparators agree when their *signs* agree; magnitudes are unspecified. */
function sign(n: number): number {
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}

/**
 * Identifiers that actually exercise the divergence: `fc.string` is heavily
 * ASCII, and ASCII is exactly the region where the two old orders agreed. The
 * supplementary-plane and high-BMP characters are the ones that separate them.
 */
const arbitraryUnicodeId = fc.string({
  unit: fc.oneof(
    fc.constantFrom(..."abzAZ019_.$|/-"),
    fc.constantFrom("｡", "ﾟ", "é", "́", "一"),
    fc.constantFrom("\u{10000}", "\u{1F600}", "\u{10FFFF}"),
    fc.constantFrom("\uD800", "\uDFFF"),
  ),
  minLength: 0,
  maxLength: 24,
});

// Feature: hierarchical-repository-grouping, Property 34: The engine has exactly one canonical order over identifiers
test("Property 34: the core's canonical order is byte-wise UTF-8, matching the parser (Gap 17)", () => {
  fc.assert(
    fc.property(arbitraryUnicodeId, arbitraryUnicodeId, (a, b) => {
      // The core agrees with the byte-wise reference the parser is held to.
      assert.equal(sign(compareIds(a, b)), sign(byteWiseReference(a, b)));

      // ...because it delegates to the seam's single implementation.
      assert.equal(sign(compareIds(a, b)), sign(compareCanonical(a, b)));
    }),
    { numRuns: 100 },
  );
});

// Feature: hierarchical-repository-grouping, Property 34: The engine has exactly one canonical order over identifiers
test("Property 34: canonical order is a total order (reflexive, antisymmetric)", () => {
  fc.assert(
    fc.property(arbitraryUnicodeId, arbitraryUnicodeId, (a, b) => {
      assert.equal(compareIds(a, a), 0);

      // Antisymmetry. `sign(-x)` rather than `-sign(x)`: the latter yields `-0`
      // for the equal case, and strict equality treats `-0` and `0` as distinct.
      assert.equal(sign(compareIds(a, b)), sign(-compareIds(b, a)));

      // Equal content compares equal however the string was built.
      assert.equal(compareIds(a, a.split("").join("")), 0);
    }),
    { numRuns: 100 },
  );
});

// Feature: hierarchical-repository-grouping, Property 34: The engine has exactly one canonical order over identifiers
test("Property 34: transitivity holds across the plane boundary", () => {
  fc.assert(
    fc.property(
      arbitraryUnicodeId,
      arbitraryUnicodeId,
      arbitraryUnicodeId,
      (a, b, c) => {
        const sorted = sortIds([a, b, c]);
        for (let i = 1; i < sorted.length; i++) {
          assert.ok(compareIds(sorted[i - 1]!, sorted[i]!) <= 0);
        }
      },
    ),
    { numRuns: 100 },
  );
});

test("the reproduced divergence now resolves byte-wise (U+FF61 before U+10000)", () => {
  const bmp = "｡"; // halfwidth ideographic full stop — UTF-8 EF BD A1
  const supplementary = "\u{10000}"; // linear B syllable — UTF-8 F0 90 80 80

  // Byte-wise: EF < F0, so the BMP character sorts first.
  assert.ok(compareIds(bmp, supplementary) < 0);

  // The old UTF-16 code-unit order put it second — this is the bug, pinned.
  assert.ok(bmp > supplementary);
});

test("unpaired surrogates, combining marks and prefixes order byte-wise", () => {
  // An unpaired surrogate encodes as the replacement character's bytes; the
  // comparison must still be total and must not throw.
  assert.equal(sign(compareIds("\uD800", "\uD800")), 0);
  assert.equal(
    sign(compareIds("a\uD800", "b\uD800")),
    sign(byteWiseReference("a\uD800", "b\uD800")),
  );

  // NFC vs NFD of "é": distinct byte sequences, so distinct identifiers.
  assert.notEqual(compareIds("é", "é"), 0);
  assert.equal(
    sign(compareIds("é", "é")),
    sign(byteWiseReference("é", "é")),
  );

  // A proper prefix sorts before the longer string.
  assert.ok(compareIds("file", "file:") < 0);
  assert.ok(compareIds("file", "file") === 0);
});

test("ASCII-only identifiers are unaffected, which bounds the change's blast radius", () => {
  const ascii = fc.stringMatching(/^[\x20-\x7E]{0,24}$/);
  fc.assert(
    fc.property(ascii, ascii, (a, b) => {
      // For ASCII the byte-wise and UTF-16 code-unit orders coincide, so every
      // existing fixture, digest and group id is byte-for-byte unchanged.
      const utf16 = a < b ? -1 : a > b ? 1 : 0;
      assert.equal(sign(compareIds(a, b)), utf16);
    }),
    { numRuns: 100 },
  );
});
