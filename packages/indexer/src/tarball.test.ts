/**
 * Hardening of the archive reader (hosting-2 Requirements 4 and 13.4): crafted
 * archives, built in the test, for every case of 4.3 to 4.6.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, describe, test } from "node:test";
import { gzipSync } from "node:zlib";
import tar from "tar-stream";
import type { FetchCaps, FetchRequest, FetchResult } from "./source-fetcher.js";
import { createGithubSourceFetcher } from "./source-fetcher-github.js";
import { createLocalSourceFetcher } from "./source-fetcher-local.js";
import { DEFAULT_FETCH_CAPS, readTarGz } from "./tarball.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const TOP = `acme-widgets-${SHA}`;
const request: FetchRequest = { owner: "acme", repo: "widgets", commitSha: SHA, tier: "S" };

interface Spec {
  name: string;
  body?: string | Buffer;
  type?: tar.Header["type"];
  linkname?: string;
}

/** A gzipped tar of the given entries, in order. */
async function archive(specs: readonly Spec[], pax?: Record<string, string>): Promise<Buffer> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    pack.on("data", (chunk: unknown) => chunks.push(chunk as Buffer));
    pack.on("end", resolve);
    pack.on("error", reject);
  });
  for (const spec of specs) {
    const body = spec.body === undefined ? undefined : Buffer.from(spec.body);
    await new Promise<void>((resolve, reject) => {
      const header: Parameters<tar.Pack["entry"]>[0] = {
        name: spec.name,
        type: spec.type ?? "file",
        size: body?.length ?? 0,
        ...(spec.linkname === undefined ? {} : { linkname: spec.linkname }),
        ...(pax === undefined ? {} : { pax }),
      };
      pack.entry(header, body ?? Buffer.alloc(0), (error) => (error ? reject(error) : resolve()));
    });
  }
  pack.finalize();
  await done;
  return gzipSync(Buffer.concat(chunks));
}

function run(gz: Buffer, overrides: Partial<FetchCaps> = {}, tier: FetchRequest["tier"] = "S"): Promise<FetchResult> {
  return readTarGz(async () => Readable.from([gz]), { ...request, tier }, { ...DEFAULT_FETCH_CAPS, ...overrides });
}

function expectFailure(result: FetchResult, failureClass: "user" | "system", code: string): void {
  assert.equal(result.ok, false);
  assert.ok("failure" in result, `expected a failure, got ${JSON.stringify(result)}`);
  assert.equal(result.failure.failureClass, failureClass);
  assert.equal(result.failure.code, code);
}

const java = (name: string): Spec => ({ name: `${TOP}/${name}`, body: `class ${name.replace(/\W/g, "_")} {}` });

describe("tarball reader: the accepted shape", () => {
  test("strips the top-level directory and returns selected files as bytes", async () => {
    const gz = await archive([
      { name: `${TOP}/`, type: "directory" },
      java("src/A.java"),
      { name: `${TOP}/README.md`, body: "# readme" },
      java("src/b/B.java"),
    ]);
    const result = await run(gz);
    assert.ok(result.ok);
    assert.deepEqual(result.source.entries.map((entry) => entry.path), ["src/A.java", "src/b/B.java"]);
    assert.equal(Buffer.from(result.source.entries[0]?.bytes ?? []).toString("utf8"), "class src_A_java {}");
    assert.equal(result.source.entryCount, 4);
  });

  test("a pax extended header is metadata, not an entry", async () => {
    const gz = await archive([java("A.java")], { comment: SHA });
    const result = await run(gz);
    assert.ok(result.ok);
    assert.equal(result.source.entryCount, 1);
  });

  test("does not rely on the directory's name", async () => {
    const gz = await archive([{ name: "whatever-abc/A.java", body: "class A {}" }]);
    const result = await run(gz);
    assert.ok(result.ok);
    assert.equal(result.source.entries[0]?.path, "A.java");
  });

  test("skips excluded directories without selecting them", async () => {
    const gz = await archive([java("A.java"), java("node_modules/x/Bad.java")]);
    const result = await run(gz);
    assert.ok(result.ok);
    assert.deepEqual(result.source.entries.map((entry) => entry.path), ["A.java"]);
  });
});

describe("tarball reader: 4.3 top-level directory", () => {
  test("an entry outside any directory fails as user", async () => {
    expectFailure(await run(await archive([{ name: "A.java", body: "class A {}" }])), "user", "ARCHIVE_LAYOUT");
  });

  test("two top-level directories fail as user", async () => {
    const gz = await archive([java("A.java"), { name: "other/B.java", body: "class B {}" }]);
    expectFailure(await run(gz), "user", "ARCHIVE_LAYOUT");
  });
});

describe("tarball reader: 4.4 unsafe paths, links and duplicates", () => {
  test("a .. segment fails as user", async () => {
    expectFailure(await run(await archive([java("a/../../evil.java")])), "user", "ARCHIVE_BAD_PATH");
  });

  test("an absolute path fails as user", async () => {
    expectFailure(await run(await archive([{ name: "/etc/Evil.java", body: "x" }])), "user", "ARCHIVE_BAD_PATH");
  });

  test("a backslash fails as user", async () => {
    expectFailure(await run(await archive([java("a\\B.java")])), "user", "ARCHIVE_BAD_PATH");
  });

  test("two selected entries with the same path fail as user", async () => {
    expectFailure(await run(await archive([java("A.java"), java("A.java")])), "user", "ARCHIVE_DUPLICATE_PATH");
  });

  test("symlinks, hardlinks and devices are skipped, never followed", async () => {
    const gz = await archive([
      java("A.java"),
      { name: `${TOP}/Link.java`, type: "symlink", linkname: "/etc/passwd" },
      { name: `${TOP}/Hard.java`, type: "link", linkname: `${TOP}/A.java` },
      { name: `${TOP}/Dev.java`, type: "character-device" },
    ]);
    const result = await run(gz);
    assert.ok(result.ok);
    assert.deepEqual(result.source.entries.map((entry) => entry.path), ["A.java"]);
  });
});

describe("tarball reader: 4.5 and 4.6 caps", () => {
  test("a per-file cap fails as user", async () => {
    const gz = await archive([{ name: `${TOP}/Big.java`, body: "x".repeat(100) }]);
    expectFailure(await run(gz, { maxSelectedFileBytes: 50 }), "user", "FILE_TOO_LARGE");
  });

  test("the per-file cap does not apply to entries the policy skips", async () => {
    const gz = await archive([java("A.java"), { name: `${TOP}/big.bin`, body: "x".repeat(10_000) }]);
    assert.ok((await run(gz, { maxSelectedFileBytes: 100 })).ok);
  });

  test("the entry-count cap fails as user", async () => {
    const gz = await archive([java("A.java"), java("B.java"), java("C.java")]);
    expectFailure(await run(gz, { maxEntries: 2 }), "user", "ARCHIVE_TOO_MANY_ENTRIES");
  });

  test("the download cap fails as user", async () => {
    const gz = await archive([java("A.java")]);
    expectFailure(await run(gz, { maxDownloadedBytes: 20 }), "user", "ARCHIVE_TOO_LARGE");
  });

  test("the decompressed cap fails as user", async () => {
    const gz = await archive([{ name: `${TOP}/zeros.bin`, body: Buffer.alloc(200_000) }, java("A.java")]);
    assert.ok(gz.length < 2_000, "a compressible archive");
    expectFailure(await run(gz, { maxDecompressedBytes: 50_000 }), "user", "ARCHIVE_TOO_LARGE");
  });

  test("no selected Java files fails as user", async () => {
    expectFailure(await run(await archive([{ name: `${TOP}/README.md`, body: "x" }])), "user", "NO_JAVA_FILES");
  });

  test("more files than the tier retiers to the smallest tier that fits", async () => {
    const specs = Array.from({ length: 1_001 }, (_, i) => java(`p/C${i}.java`));
    const result = await run(await archive(specs), {}, "S");
    assert.deepEqual(result, { ok: false, retier: "M" });
    assert.ok((await run(await archive(specs), {}, "M")).ok);
  });
});

describe("tarball reader: failures that are not the archive's fault", () => {
  test("a corrupt gzip stream fails as system", async () => {
    expectFailure(await run(Buffer.from("this is not gzip data at all")), "system", "FETCH_FAILED");
  });

  test("a stream that never ends times out as system", async () => {
    const result = await readTarGz(
      async () => new Readable({ read() {} }),
      request,
      { ...DEFAULT_FETCH_CAPS, timeoutMs: 50 },
    );
    expectFailure(result, "system", "FETCH_TIMEOUT");
  });

  test("the caller's abort fails as system", async () => {
    const controller = new AbortController();
    const pending = readTarGz(async () => new Readable({ read() {} }), request, DEFAULT_FETCH_CAPS, controller.signal);
    setTimeout(() => controller.abort(), 20);
    expectFailure(await pending, "system", "FETCH_ABORTED");
  });

  test("an open that rejects fails as system", async () => {
    const result = await readTarGz(async () => Promise.reject(new Error("boom")), request, DEFAULT_FETCH_CAPS);
    expectFailure(result, "system", "FETCH_FAILED");
  });
});

describe("fetchers", () => {
  const dir = mkdtempSync(join(tmpdir(), "repohive-tarball-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test("the local fetcher reads a .tar.gz file through the same path", async () => {
    const file = join(dir, "a.tar.gz");
    writeFileSync(file, await archive([java("A.java")]));
    const result = await createLocalSourceFetcher(file).fetch(request, DEFAULT_FETCH_CAPS);
    assert.ok(result.ok);
    assert.equal(result.source.entries[0]?.path, "A.java");
  });

  test("the GitHub fetcher requests the validated tarball URL with the server token", async () => {
    const gz = await archive([java("A.java")]);
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetcher = createGithubSourceFetcher({
      token: "t0ken",
      fetch: async (url, init) => {
        calls.push({ url, headers: init?.headers as Record<string, string> });
        return new Response(new Uint8Array(gz));
      },
    });
    const result = await fetcher.fetch(request, DEFAULT_FETCH_CAPS);
    assert.ok(result.ok);
    assert.equal(calls[0]?.url, `https://api.github.com/repos/acme/widgets/tarball/${SHA}`);
    assert.equal(calls[0]?.headers.Authorization, "Bearer t0ken");
  });

  test("the GitHub fetcher never builds a URL from an unvalidated name", async () => {
    let called = false;
    const fetcher = createGithubSourceFetcher({
      token: "t",
      fetch: async () => {
        called = true;
        return new Response("");
      },
    });
    const result = await fetcher.fetch({ ...request, owner: "../evil" }, DEFAULT_FETCH_CAPS);
    expectFailure(result, "system", "FETCH_FAILED");
    assert.equal(called, false);
    const badSha = await fetcher.fetch({ ...request, commitSha: "main" }, DEFAULT_FETCH_CAPS);
    expectFailure(badSha, "system", "FETCH_FAILED");
    assert.equal(called, false);
  });

  test("a non-200 archive answer fails as system", async () => {
    const fetcher = createGithubSourceFetcher({ token: "t", fetch: async () => new Response("no", { status: 404 }) });
    expectFailure(await fetcher.fetch(request, DEFAULT_FETCH_CAPS), "system", "FETCH_FAILED");
  });
});
