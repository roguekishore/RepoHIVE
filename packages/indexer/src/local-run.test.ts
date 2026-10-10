/**
 * The local end-to-end run: pre-check on a stubbed
 * GitHub, then `runJob`, then a second run that is a cache hit (the manifest already exists in the store).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { gzipSync } from "node:zlib";
import tar from "tar-stream";
import { createMemoryArtifactStore } from "./artifact-store-memory.js";
import { manifestKey } from "./layout.js";
import { createMemoryJobReporter } from "./reporter-memory.js";
import { runLocal } from "./local-run.js";

const SHA = "fedcba9876543210fedcba9876543210fedcba98";
const scratch = mkdtempSync(join(tmpdir(), "repohive-local-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

async function tarball(files: Record<string, string>, name: string): Promise<string> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve) => {
    pack.on("data", (chunk: unknown) => chunks.push(chunk as Buffer));
    pack.on("end", resolve);
  });
  for (const [path, body] of Object.entries(files)) {
    await new Promise<void>((resolve) => pack.entry({ name: `acme-tiny-${SHA}/${path}` }, body, () => resolve()));
  }
  pack.finalize();
  await done;
  const file = join(scratch, `${name}.tar.gz`);
  writeFileSync(file, gzipSync(Buffer.concat(chunks)));
  return file;
}

const JAVA = {
  "src/A.java": "package p;\npublic class A { B b; }\n",
  "src/B.java": "package p;\npublic class B {}\n",
  "NOTES.md": "notes",
};

test("pre-check, job and cache hit run end to end with no network", async () => {
  const file = await tarball(JAVA, "tiny");
  const store = createMemoryArtifactStore();
  const reporter = createMemoryJobReporter();
  const lines: string[] = [];
  const options = {
    tarballPath: file,
    repo: "Acme/Tiny",
    commitSha: SHA,
    store,
    reporter,
    tmpRoot: scratch,
    write: (line: string) => lines.push(line),
  };

  const first = await runLocal(options);
  assert.equal(first.kind, "ran");
  if (first.kind !== "ran") return;
  assert.equal(first.tier, "S");
  assert.equal(first.result.status, "succeeded", JSON.stringify(first.result));
  assert.ok(await store.get(manifestKey("github.com/acme/tiny", first.snapshotId)));
  assert.equal(reporter.outcome()?.status, "succeeded");
  assert.ok(lines.some((line) => line.includes("JobsSucceeded")));
  assert.deepEqual(readdirSync(scratch).filter((name) => name.startsWith("repohive-job-")), []);

  const second = await runLocal(options);
  assert.deepEqual(second, { kind: "cache-hit", snapshotId: first.snapshotId });
});

test("a tier override is honoured, and a repository with no Java is rejected before any job", async () => {
  const store = createMemoryArtifactStore();
  const noJava = await runLocal({
    tarballPath: await tarball({ "README.md": "x" }, "nojava"),
    repo: "acme/none",
    commitSha: SHA,
    store,
    tmpRoot: scratch,
  });
  assert.equal(noJava.kind, "rejected");
  assert.equal(noJava.kind === "rejected" && noJava.reason, "NO_JAVA_FILES");
  assert.deepEqual([...store.objects.keys()], []);

  const bigger = await runLocal({
    tarballPath: await tarball(JAVA, "tier"),
    repo: "acme/tier",
    commitSha: SHA,
    store,
    tier: "L",
    tmpRoot: scratch,
    write: () => undefined,
  });
  assert.equal(bigger.kind === "ran" && bigger.tier, "L");
  assert.equal(bigger.kind === "ran" && bigger.result.status, "succeeded");
});
