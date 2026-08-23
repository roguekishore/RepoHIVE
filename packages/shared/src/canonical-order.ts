/**
 * The engine's single canonical order over identifier strings.
 *
 * Both halves of the engine sort by identifier, and both MUST mean the same
 * thing by "canonical order". The parser has always compared byte-wise over the
 * UTF-8 encoding (R9.2, R9.3); the core originally used JavaScript's `<`/`>`,
 * which compares UTF-16 code units. The two disagree whenever a supplementary-
 * plane character meets a high-BMP one — for example `U+FF61` sorts *before*
 * `U+10000` byte-wise but *after* it by code unit — so "canonical order" was two
 * orders, not one.
 *
 * Byte-wise UTF-8 is the order this module defines, because it is the only one a
 * requirement states explicitly and because it is encoding-independent: a future
 * non-JavaScript consumer reading the same bytes derives the same order without
 * knowing anything about UTF-16 surrogate pairs.
 *
 * This module is the seam's one piece of runtime code. It exists here, rather
 * than being mirrored into each package, so the two sides cannot drift again.
 */

/**
 * UTF-8 encodings of identifiers seen so far.
 *
 * Sorting is O(n log n) *comparisons* but only O(n) *distinct strings*, so
 * encoding once per identifier rather than once per comparison is what keeps
 * byte-wise ordering affordable on repositories with thousands of files. The
 * cache is a pure memo — it changes cost, never results.
 */
const utf8 = new Map<string, Buffer>();

/** The UTF-8 bytes of `value`, encoding on first use. */
function bytesOf(value: string): Buffer {
  let bytes = utf8.get(value);
  if (bytes === undefined) {
    bytes = Buffer.from(value, "utf8");
    utf8.set(value, bytes);
  }
  return bytes;
}

/**
 * Compare two identifiers byte-wise over their UTF-8 encoding.
 *
 * Returns a negative number when `a` sorts before `b`, a positive number when it
 * sorts after, and `0` when the two are byte-for-byte equal. The order is total
 * and antisymmetric, which is what makes every sort in the engine deterministic.
 *
 * Equal strings short-circuit before encoding: it is the most common case in a
 * comparison-heavy sort and needs no bytes to answer.
 */
export function compareCanonical(a: string, b: string): number {
  return a === b ? 0 : Buffer.compare(bytesOf(a), bytesOf(b));
}
