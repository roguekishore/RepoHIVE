/**
 * The shared {@link ArtifactStore} contract, run against the memory, directory
 * and S3 implementations (the last on a mocked client), plus S3 specifics.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import type { ArtifactStore, ObjectHeaders } from "./artifact-store.js";
import { createLocalArtifactStore } from "./artifact-store-local.js";
import { createMemoryArtifactStore } from "./artifact-store-memory.js";
import { createS3ArtifactStore } from "./artifact-store-s3.js";

const scratch = mkdtempSync(join(tmpdir(), "repohive-store-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const s3 = mockClient(S3Client);
const bucket = new Map<string, { body: Uint8Array; headers: ObjectHeaders }>();

/** Makes the mocked S3 client behave like a small bucket. */
function fakeBucket(pageSize = 1000): void {
  bucket.clear();
  s3.reset();
  s3.on(PutObjectCommand).callsFake((input) => {
    bucket.set(input.Key, {
      body: Uint8Array.from(input.Body as Uint8Array),
      headers: {
        contentType: input.ContentType,
        ...(input.ContentEncoding === undefined ? {} : { contentEncoding: input.ContentEncoding }),
        ...(input.CacheControl === undefined ? {} : { cacheControl: input.CacheControl }),
      },
    });
    return {};
  });
  s3.on(GetObjectCommand).callsFake((input) => {
    const object = bucket.get(input.Key);
    if (object === undefined) {
      throw Object.assign(new Error("no such key"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    }
    return {
      Body: { transformToByteArray: async () => object.body } as never,
      ContentType: object.headers.contentType,
      ContentEncoding: object.headers.contentEncoding,
      CacheControl: object.headers.cacheControl,
    };
  });
  s3.on(ListObjectsV2Command).callsFake((input) => {
    const all = [...bucket.keys()].filter((key) => key.startsWith(input.Prefix ?? "")).sort();
    const start = input.ContinuationToken === undefined ? 0 : Number(input.ContinuationToken);
    const page = all.slice(start, start + pageSize);
    const more = start + pageSize < all.length;
    return {
      Contents: page.map((Key) => ({ Key })),
      IsTruncated: more,
      ...(more ? { NextContinuationToken: String(start + pageSize) } : {}),
    };
  });
  s3.on(DeleteObjectsCommand).callsFake((input) => {
    for (const { Key } of input.Delete.Objects) bucket.delete(Key);
    return {};
  });
}

const implementations: [string, () => ArtifactStore][] = [
  ["memory", () => createMemoryArtifactStore()],
  ["directory", () => createLocalArtifactStore(mkdtempSync(join(scratch, "dir-")))],
  [
    "s3 (mocked client)",
    () => {
      fakeBucket();
      return createS3ArtifactStore({ client: new S3Client({ region: "ap-south-1" }), bucket: "test-bucket" });
    },
  ],
];

const brotli: ObjectHeaders = { contentType: "application/json", contentEncoding: "br", cacheControl: "public, max-age=31536000, immutable" };
const plain: ObjectHeaders = { contentType: "application/json" };

for (const [name, make] of implementations) {
  describe(`ArtifactStore contract: ${name}`, () => {
    let store: ArtifactStore;
    beforeEach(() => {
      store = make();
    });

    test("put then get returns the body and headers; a missing key is undefined", async () => {
      await store.put("s/abc/views/repo.json", Buffer.from("hello"), brotli);
      await store.put("r/github.com/a/b/latest.json", Buffer.from("{}"), plain);
      const got = await store.get("s/abc/views/repo.json");
      assert.equal(Buffer.from(got!.body).toString("utf8"), "hello");
      assert.deepEqual(got!.headers, brotli);
      assert.deepEqual((await store.get("r/github.com/a/b/latest.json"))!.headers, plain);
      assert.equal(await store.get("s/abc/missing.json"), undefined);
    });

    test("put replaces an object", async () => {
      await store.put("k/one", Buffer.from("1"), plain);
      await store.put("k/one", Buffer.from("2"), plain);
      assert.equal(Buffer.from((await store.get("k/one"))!.body).toString("utf8"), "2");
    });

    test("list returns the keys under a prefix, sorted byte-wise", async () => {
      for (const key of ["s/b/x", "s/a/y", "s/a/x", "idx/a/x", "s/a/views/z"]) {
        await store.put(key, Buffer.from("."), plain);
      }
      assert.deepEqual(await store.list("s/a/"), ["s/a/views/z", "s/a/x", "s/a/y"]);
      assert.deepEqual(await store.list("s/"), ["s/a/views/z", "s/a/x", "s/a/y", "s/b/x"]);
      assert.deepEqual(await store.list("nothing/"), []);
    });

    test("delete removes the given keys and tolerates a missing one", async () => {
      await store.put("d/a", Buffer.from("."), plain);
      await store.put("d/b", Buffer.from("."), plain);
      await store.delete(["d/a", "d/never"]);
      assert.deepEqual(await store.list("d/"), ["d/b"]);
      assert.equal(await store.get("d/a"), undefined);
    });
  });
}

describe("S3 artifact store specifics", () => {
  afterEach(() => s3.reset());

  test("sends the headers and the key as given, with no tags and no versioning calls", async () => {
    fakeBucket();
    const store = createS3ArtifactStore({ client: new S3Client({ region: "ap-south-1" }), bucket: "b" });
    await store.put("s/abc/manifest.json", Buffer.from("x"), brotli);
    const call = s3.commandCalls(PutObjectCommand)[0]!.args[0].input;
    assert.equal(call.Bucket, "b");
    assert.equal(call.Key, "s/abc/manifest.json");
    assert.equal(call.ContentType, "application/json");
    assert.equal(call.ContentEncoding, "br");
    assert.equal(call.CacheControl, "public, max-age=31536000, immutable");
    assert.equal(call.Tagging, undefined);
    await store.put("meta/x/history.json", Buffer.from("x"), plain);
    const second = s3.commandCalls(PutObjectCommand)[1]!.args[0].input;
    assert.equal(second.ContentEncoding, undefined);
    assert.equal(second.CacheControl, undefined);
  });

  test("lists across pages", async () => {
    fakeBucket(2);
    const store = createS3ArtifactStore({ client: new S3Client({ region: "ap-south-1" }), bucket: "b" });
    for (let i = 0; i < 5; i += 1) await store.put(`p/${i}`, Buffer.from("."), plain);
    assert.deepEqual(await store.list("p/"), ["p/0", "p/1", "p/2", "p/3", "p/4"]);
    assert.equal(s3.commandCalls(ListObjectsV2Command).length, 3);
  });

  test("deletes in batches of 1,000 keys", async () => {
    fakeBucket();
    const store = createS3ArtifactStore({ client: new S3Client({ region: "ap-south-1" }), bucket: "b" });
    const keys = Array.from({ length: 2_500 }, (_, i) => `d/${i}`);
    await store.delete(keys);
    const sizes = s3.commandCalls(DeleteObjectsCommand).map((call) => call.args[0].input.Delete!.Objects!.length);
    assert.deepEqual(sizes, [1000, 1000, 500]);
  });

  test("a delete the service reports as failed throws", async () => {
    s3.reset();
    s3.on(DeleteObjectsCommand).resolves({ Errors: [{ Key: "d/a", Code: "AccessDenied" }] });
    const store = createS3ArtifactStore({ client: new S3Client({ region: "ap-south-1" }), bucket: "b" });
    await assert.rejects(store.delete(["d/a"]), /AccessDenied/);
  });

  test("a get that fails for another reason is not hidden as a missing key", async () => {
    s3.reset();
    s3.on(GetObjectCommand).rejects(Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }));
    const store = createS3ArtifactStore({ client: new S3Client({ region: "ap-south-1" }), bucket: "b" });
    await assert.rejects(store.get("k"), /denied/);
  });
});
