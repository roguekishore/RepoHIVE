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
  compressBrotli,
  headersForKey,
  prepareObject,
  prepareObjects,
} from "./compression.js";

const ID = "0123456789abcdef0123456789abcdef";
const A = `artifacts/acme/widgets/${ID}`;
const P = `private/acme/widgets/${ID}`;
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

test("objects under artifacts/ are brotli JSON, cached forever", () => {
  for (const key of [`${A}/manifest.json`, `${A}/views/repo.json`, `${A}/views/region-detail/3.json`]) {
    assert.deepEqual(headersForKey(key), {
      contentType: "application/json",
      contentEncoding: "br",
      cacheControl: "public, max-age=31536000, immutable",
    });
  }
  assert.equal(IMMUTABLE_CACHE_CONTROL, "public, max-age=31536000, immutable");
});

test("private index objects are brotli JSON, cached forever", () => {
  assert.deepEqual(headersForKey(`${P}/index/nodes.json`), {
    contentType: "application/json",
    contentEncoding: "br",
    cacheControl: "public, max-age=31536000, immutable",
  });
});

test("history.json is uncompressed and carries no cache header", () => {
  assert.deepEqual(headersForKey("private/acme/widgets/history.json"), { contentType: "application/json" });
});

test("a key outside the layout is rejected, by exact shape", () => {
  for (const key of [
    "views/repo.json",
    "s/" + ID + "/manifest.json",
    "idx/" + ID + "/nodes.json",
    "r/github.com/acme/widgets/latest.json",
    "meta/github.com/acme/widgets/history.json",
    "x/y",
    "artifacts/acme/widgets/manifest.json",
    `artifacts/acme/${ID}/manifest.json`,
    `artifacts/acme/widgets/${ID.toUpperCase()}/manifest.json`,
    `artifacts/acme/widgets/${ID}/`,
    `artifacts/acme/widgets/${ID}/../x`,
    `artifacts/../widgets/${ID}/manifest.json`,
    `private/acme/widgets/${ID}/nodes.json`,
    `private/acme/widgets/${ID}/index/`,
    `private/acme/widgets/${ID}/index/a/b.json`,
    `private/acme/widgets/${ID}/history.json`,
    "private/acme/widgets/latest.json",
    "private/acme/widgets/history.json/x",
    "private/acme/history.json",
    "private/history.json",
  ]) {
    assert.throws(() => headersForKey(key), RangeError, key);
  }
});

test("a prepared object hashes the uncompressed bytes and stores the compressed ones", async () => {
  const prepared = await prepareObject({ key: `${A}/views/graph.json`, content: CONTENT });
  assert.equal(prepared.bytes, CONTENT.byteLength);
  assert.equal(prepared.sha256, createHash("sha256").update(CONTENT).digest("hex"));
  assert.deepEqual(brotliDecompressSync(prepared.body), CONTENT);
  assert.equal(prepared.headers.contentEncoding, "br");
});

test("history.json is stored byte-for-byte", async () => {
  const content = Buffer.from('{"snapshots":[]}', "utf8");
  const prepared = await prepareObject({ key: "private/acme/widgets/history.json", content });
  assert.deepEqual(prepared.body, content);
  assert.equal(prepared.headers.contentEncoding, undefined);
});

test("objects prepared together keep their input order", async () => {
  const objects = Array.from({ length: 40 }, (_, i) => ({
    key: `${A}/views/region-detail/${i}.json`,
    content: Buffer.from(JSON.stringify({ i, pad: "x".repeat(i * 100) }), "utf8"),
  }));
  const prepared = await prepareObjects(objects);
  assert.deepEqual(
    prepared.map((object) => object.key),
    objects.map((object) => object.key),
  );
  prepared.forEach((object, i) => assert.deepEqual(brotliDecompressSync(object.body), objects[i]?.content));
});
