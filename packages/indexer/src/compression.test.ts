/**
 * Compression and object headers.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import {
  BROTLI_QUALITY,
  IMMUTABLE_CACHE_CONTROL,
  LATEST_CACHE_CONTROL,
  compressBrotli,
  headersForKey,
  prepareObject,
  prepareObjects,
} from "./compression.js";

const ID = "0123456789abcdef0123456789abcdef";
const CONTENT = Buffer.from(JSON.stringify({ nodes: Array.from({ length: 500 }, (_, i) => `node-${i}`) }), "utf8");

test("brotli runs at quality 9 and round-trips", async () => {
  assert.equal(BROTLI_QUALITY, 9);
  const compressed = await compressBrotli(CONTENT);
  const reference = brotliCompressSync(CONTENT, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } });
  assert.deepEqual(compressed, reference);
  assert.deepEqual(brotliDecompressSync(compressed), CONTENT);
  assert.ok(compressed.byteLength < CONTENT.byteLength);
});

test("the same content compresses to the same bytes", async () => {
  const [a, b] = await Promise.all([compressBrotli(CONTENT), compressBrotli(Buffer.from(CONTENT))]);
  assert.deepEqual(a, b);
});

test("objects under s/ are brotli JSON, cached forever", () => {
  for (const key of [`s/${ID}/manifest.json`, `s/${ID}/views/repo.json`, `s/${ID}/views/region-detail/3.json`]) {
    assert.deepEqual(headersForKey(key), {
      contentType: "application/json",
      contentEncoding: "br",
      cacheControl: "public, max-age=31536000, immutable",
    });
  }
  assert.equal(IMMUTABLE_CACHE_CONTROL, "public, max-age=31536000, immutable");
});

test("index objects are brotli-compressed", () => {
  assert.equal(headersForKey(`idx/${ID}/nodes.json`).contentEncoding, "br");
});

test("latest.json is uncompressed with a short cache", () => {
  assert.deepEqual(headersForKey("r/github.com/acme/widgets/latest.json"), {
    contentType: "application/json",
    cacheControl: "public, max-age=30, stale-while-revalidate=60",
  });
  assert.equal(LATEST_CACHE_CONTROL, "public, max-age=30, stale-while-revalidate=60");
});

test("history.json is uncompressed and carries no cache header", () => {
  assert.deepEqual(headersForKey("meta/github.com/acme/widgets/history.json"), { contentType: "application/json" });
});

test("a key outside the layout is rejected", () => {
  for (const key of ["views/repo.json", "r/github.com/acme/widgets/other.json", "x/y"]) {
    assert.throws(() => headersForKey(key), RangeError, key);
  }
});

test("a prepared object hashes the uncompressed bytes and stores the compressed ones", async () => {
  const prepared = await prepareObject({ key: `s/${ID}/views/graph.json`, content: CONTENT });
  assert.equal(prepared.bytes, CONTENT.byteLength);
  assert.equal(prepared.sha256, createHash("sha256").update(CONTENT).digest("hex"));
  assert.deepEqual(brotliDecompressSync(prepared.body), CONTENT);
  assert.equal(prepared.headers.contentEncoding, "br");
});

test("latest.json is stored byte-for-byte", async () => {
  const content = Buffer.from('{"pointerVersion":1}', "utf8");
  const prepared = await prepareObject({ key: "r/github.com/acme/widgets/latest.json", content });
  assert.deepEqual(prepared.body, content);
  assert.equal(prepared.headers.contentEncoding, undefined);
});

test("objects prepared together keep their input order", async () => {
  const objects = Array.from({ length: 40 }, (_, i) => ({
    key: `s/${ID}/views/region-detail/${i}.json`,
    content: Buffer.from(JSON.stringify({ i, pad: "x".repeat(i * 100) }), "utf8"),
  }));
  const prepared = await prepareObjects(objects);
  assert.deepEqual(
    prepared.map((object) => object.key),
    objects.map((object) => object.key),
  );
  prepared.forEach((object, i) => assert.deepEqual(brotliDecompressSync(object.body), objects[i]?.content));
});
