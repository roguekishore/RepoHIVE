/**
 * Canonical JSON (hosting-2 Requirement 7): keys sorted byte-wise at every
 * level, no whitespace, the same string for equal values.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { canonicalJson, compareBytewise, sha256Hex } from "./canonical-json.js";

test("keys are sorted at every level and there is no whitespace", () => {
  const value = { b: [{ z: 1, a: "x" }, 2], a: { d: null, c: true } };
  assert.equal(canonicalJson(value), '{"a":{"c":true,"d":null},"b":[{"a":"x","z":1},2]}');
});

test("key insertion order does not change the output", () => {
  assert.equal(canonicalJson({ x: 1, y: { p: 1, q: 2 } }), canonicalJson({ y: { q: 2, p: 1 }, x: 1 }));
});

test("keys sort by UTF-8 bytes, not UTF-16 code units", () => {
  // U+FF61 is 0xEF 0xBD 0xA1 in UTF-8; U+1F600 is 0xF0 ... and so sorts after it,
  // although its first UTF-16 code unit (0xD83D) is smaller than 0xFF61.
  const emoji = "\u{1F600}";
  const halfwidth = "\uFF61";
  assert.ok(compareBytewise(halfwidth, emoji) < 0);
  assert.ok(halfwidth > emoji, "UTF-16 order is the other way round");
  assert.equal(canonicalJson({ [emoji]: 1, [halfwidth]: 2 }), `{"${halfwidth}":2,"${emoji}":1}`);
  assert.equal(canonicalJson({ a: 1, B: 2 }), '{"B":2,"a":1}');
});

test("strings are escaped as JSON.stringify escapes them", () => {
  assert.equal(canonicalJson({ 'q"\n': 'v"\\' }), JSON.stringify({ 'q"\n': 'v"\\' }));
});

test("non-finite numbers are rejected", () => {
  assert.throws(() => canonicalJson({ n: Number.NaN }), TypeError);
  assert.throws(() => canonicalJson([Number.POSITIVE_INFINITY]), TypeError);
});

test("sha256Hex hashes strings as UTF-8 and bytes as given", () => {
  const expected = createHash("sha256").update(Buffer.from("h\u00e9", "utf8")).digest("hex");
  assert.equal(sha256Hex("h\u00e9"), expected);
  assert.equal(sha256Hex(Buffer.from("h\u00e9", "utf8")), expected);
  assert.match(expected, /^[0-9a-f]{64}$/);
});
