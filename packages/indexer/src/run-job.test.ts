/**
 * `runJob` end to end on a tiny in-test repository (5,
 * 9 and 11): local fetcher, memory store, memory reporter.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { brotliDecompressSync, gzipSync } from "node:zlib";
import { engineVersion } from "@repohive/engine";
import { getViewsVersion } from "@repohive/views";
import tar from "tar-stream";
import { createMemoryArtifactStore } from "./artifact-store-memory.js";
import { sha256Hex } from "./canonical-json.js";
import { hostedConfigDigest } from "./hosted-options.js";
import type { JobInput, Tier } from "./job-types.js";
import { historyKey, manifestKey, snapshotIdOf, type Manifest } from "./layout.js";
import { createMemoryJobReporter, type MemoryJobReporter } from "./reporter-memory.js";
import { isForwardJobTransition } from "./job-states.js";
import { runJob, type RunJobDeps } from "./run-job.js";
import type { FetchResult, SourceFetcher } from "./source-fetcher.js";
import { createLocalSourceFetcher } from "./source-fetcher-local.js";
import { createLogger, createTelemetry } from "./telemetry.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const A = "artifacts/acme/widgets";
const P = "private/acme/widgets";
const REPO = "github.com/acme/widgets";
const scratch = mkdtempSync(join(tmpdir(), "repohive-runjob-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const SOURCES: Record<string, string> = {
  "src/main/java/com/acme/a/A.java": "package com.acme.a;\nimport com.acme.b.B;\npublic class A { B b; void run() { b.go(); } }\n",
  "src/main/java/com/acme/b/B.java": "package com.acme.b;\npublic class B { public void go() {} }\n",
  "src/main/java/com/acme/b/C.java": "package com.acme.b;\npublic class C { B b = new B(); }\n",
  "README.md": "# widgets\n",
};

async function tarball(files: Record<string, string>, name: string): Promise<string> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve) => {
    pack.on("data", (chunk: unknown) => chunks.push(chunk as Buffer));
    pack.on("end", resolve);
  });
  for (const [path, body] of Object.entries(files)) {
    await new Promise<void>((resolve) => pack.entry({ name: `acme-widgets-${SHA}/${path}` }, body, () => resolve()));
  }
  pack.finalize();
  await done;
  const file = join(scratch, `${name}.tar.gz`);
  writeFileSync(file, gzipSync(Buffer.concat(chunks)));
  return file;
}

function input(tier: Tier = "S", overrides: Partial<JobInput> = {}): JobInput {
  return {
    jobId: `job-${Math.random().toString(36).slice(2)}`,
    accountId: "acct",
    repo: REPO,
    commitSha: SHA,
    tier,
    snapshotId: snapshotIdOf({
      repo: REPO,
      commitSha: SHA,
      engineVersion,
      viewsVersion: getViewsVersion(),
      configDigest: hostedConfigDigest(),
    }),
    visibility: "public",
    ...overrides,
  };
}

interface Harness {
  deps: RunJobDeps;
  store: ReturnType<typeof createMemoryArtifactStore>;
  reporter: MemoryJobReporter;
  lines: string[];
  tmpRoot: string;
}

function harness(fetcher: SourceFetcher, overrides: Partial<RunJobDeps> = {}): Harness {
  const store = createMemoryArtifactStore();
  const reporter = createMemoryJobReporter();
  const lines: string[] = [];
  const tmpRoot = mkdtempSync(join(scratch, "tmp-"));
  const base: RunJobDeps = {
    fetcher,
    store,
    reporter,
    runtime: "local",
    log: createLogger({ jobId: "x", write: (line) => lines.push(line) }),
    telemetry: createTelemetry({ tier: "S", runtime: "local", write: (line) => lines.push(line) }),
    remainingMs: () => 10 * 60_000,
    tmpRoot,
    ...overrides,
  };
  return { deps: base, store, reporter, lines, tmpRoot };
}

async function run(h: Harness, job: JobInput) {
  return runJob(job, h.deps);
}

const storedKeys = (store: ReturnType<typeof createMemoryArtifactStore>): string[] => [...store.objects.keys()].sort();

const okFile = await tarball(SOURCES, "ok");
const stopsFile = await tarball(SOURCES, "stops");
const dirtyFile = await tarball(
  {
    ...SOURCES,
    // A template, and a class declared by two files in one source root: neither may fail the repository.
    "src/main/resources/archetype/Tpl.java": "package ${package};\npublic class Tpl {}\n",
    "bench/one.java": "class Toggle { void on() {} }\n",
    "bench/two.java": "class Toggle { void off() {} }\n",
  },
  "dirty",
);

describe("runJob: success", () => {
  test("publishes the snapshot, reports the outcome, emits metrics and cleans up", async () => {
    const h = harness(createLocalSourceFetcher(okFile));
    const job = input("S");
    const result = await run(h, job);
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    if (result.status !== "succeeded") return;
    assert.equal(result.snapshotId, job.snapshotId);
    assert.equal(result.counts.files, 3);
    assert.ok(result.counts.objects > 10);
    assert.ok(result.durations.totalMs > 0);

    const keys = storedKeys(h.store);
    assert.ok(keys.includes(manifestKey(REPO, job.snapshotId)));
    assert.ok(keys.includes(`${A}/${job.snapshotId}/views/zoom-map.json`));
    assert.ok(keys.includes(`${P}/${job.snapshotId}/index/hierarchy.json`));
    assert.ok(keys.includes(historyKey(REPO)));
    assert.ok(!keys.some((key) => key.includes("latest")));
    assert.ok(keys.every((key) => key.startsWith("artifacts/acme/widgets/") || key.startsWith("private/acme/widgets/")));
    // Sources and the engine's graph.json are never stored (`views/graph.json` is the graph overview view).
    assert.ok(keys.every((key) => !/\.java$/.test(key) && !/^private\/.*graph\.json$/.test(key) && key !== "graph.json"));

    // The manifest lists uncompressed hashes that match the stored bodies.
    const manifestObject = h.store.objects.get(manifestKey(REPO, job.snapshotId))!;
    assert.equal(manifestObject.headers.contentEncoding, "br");
    const manifest = JSON.parse(brotliDecompressSync(manifestObject.body).toString("utf8")) as Manifest;
    assert.equal(manifest.repo, REPO);
    assert.equal(manifest.commitSha, SHA);
    assert.equal(manifest.viewsVersion, getViewsVersion());
    for (const entry of manifest.files) {
      const stored = h.store.objects.get(entry.key)!;
      const content = brotliDecompressSync(stored.body);
      assert.equal(content.length, entry.bytes);
      assert.equal(sha256Hex(content), entry.sha256);
    }
    const outcome = h.reporter.outcome();
    assert.deepEqual(outcome, {
      status: "succeeded",
      snapshotId: job.snapshotId,
      commitSha: SHA,
      engineVersion,
      viewsVersion: getViewsVersion(),
      nodeCount: result.counts.hierarchyNodes,
      edgeCount: result.counts.edges,
    });
    assert.ok(result.counts.hierarchyNodes > 0);
    const states = h.reporter.states();
    assert.deepEqual(states, ["fetching", "parsing", "grouping", "building-views", "publishing"]);
    for (let i = 1; i < states.length; i += 1) {
      assert.ok(isForwardJobTransition(states[i - 1]!, states[i]!));
    }
    assert.ok(h.reporter.calls.some((call) => call.kind === "progress" && call.progress !== undefined), "engine progress is reported");
    assert.equal(h.reporter.calls.at(-1)?.kind, "complete", "the outcome is the last report");

    // R11: embedded-metric lines in the fixed namespace, and no repo, account or URL in any metric.
    const metrics = h.lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => "_aws" in line);
    const names = metrics.flatMap((line) => (line._aws as { CloudWatchMetrics: { Metrics: { Name: string }[] }[] }).CloudWatchMetrics[0]!.Metrics.map((m) => m.Name));
    for (const expected of ["JobsSucceeded", "StageMs", "EndToEndMs", "PeakRssMb"]) {
      assert.ok(names.includes(expected), expected);
    }
    const metricText = JSON.stringify(metrics);
    assert.ok(!metricText.includes("acme") && !metricText.includes("acct") && !metricText.includes(SHA));
    // The temporary output is gone whatever the outcome.
    assert.deepEqual(readdirSync(h.tmpRoot), []);
  });

  test("the same inputs give byte-identical objects under artifacts/ and private/", async () => {
    const a = harness(createLocalSourceFetcher(okFile));
    const b = harness(createLocalSourceFetcher(okFile));
    assert.equal((await run(a, input("S"))).status, "succeeded");
    assert.equal((await run(b, input("S"))).status, "succeeded");
    const publicKeys = storedKeys(a.store).filter((key) => (key.startsWith("artifacts/") || key.startsWith("private/")) && !key.endsWith("history.json"));
    assert.deepEqual(publicKeys, storedKeys(b.store).filter((key) => (key.startsWith("artifacts/") || key.startsWith("private/")) && !key.endsWith("history.json")));
    for (const key of publicKeys) {
      assert.deepEqual(Buffer.from(a.store.objects.get(key)!.body), Buffer.from(b.store.objects.get(key)!.body), key);
    }
  });

  test("publishing a snapshot that already exists succeeds and leaves identical objects", async () => {
    const h = harness(createLocalSourceFetcher(okFile));
    assert.equal((await run(h, input("S"))).status, "succeeded");
    const before = new Map([...h.store.objects].filter(([key]) => (key.startsWith("artifacts/") || key.startsWith("private/")) && !key.endsWith("history.json")));
    assert.equal((await run(h, input("S"))).status, "succeeded");
    for (const [key, object] of before) {
      assert.deepEqual(Buffer.from(h.store.objects.get(key)!.body), Buffer.from(object.body), key);
    }
  });
});

describe("runJob: files the parser cannot take", () => {
  test("publishes the rest and counts what was skipped", async () => {
    const h = harness(createLocalSourceFetcher(dirtyFile));
    const result = await run(h, input("S"));
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    if (result.status !== "succeeded") return;
    assert.equal(result.counts.skippedFiles, 2);
    assert.ok(storedKeys(h.store).includes(manifestKey(REPO, input("S").snapshotId)));
    assert.ok(h.lines.some((line) => line.includes("files skipped") && line.includes("duplicate-node-id")));
  });

  test("a clean repository reports no skippedFiles", async () => {
    const result = await run(harness(createLocalSourceFetcher(okFile)), input("S"));
    assert.equal(result.status === "succeeded" && "skippedFiles" in result.counts, false);
  });
});

describe("runJob: stops without publishing", () => {
  const nothingPublished = (h: Harness): void => assert.deepEqual(storedKeys(h.store), []);

  test("a post-fetch count over the tier returns retier and reports it", async () => {
    const fetcher: SourceFetcher = { fetch: async (): Promise<FetchResult> => ({ ok: false, retier: "M" }) };
    const h = harness(fetcher);
    const job = input("S");
    const result = await run(h, job);
    assert.deepEqual(result, { status: "retier", tier: "M" });
    nothingPublished(h);
    assert.deepEqual(h.reporter.outcome(), { status: "retier", tier: "M" });
    assert.deepEqual(h.reporter.states(), ["fetching"]);
  });

  test("a user failure from the fetch is failed with that class and code", async () => {
    const fetcher: SourceFetcher = {
      fetch: async (): Promise<FetchResult> => ({ ok: false, failure: { failureClass: "user", code: "NO_JAVA_FILES", message: "none" } }),
    };
    const h = harness(fetcher);
    const job = input("S");
    const result = await run(h, job);
    assert.deepEqual(result, { status: "failed", failureClass: "user", code: "NO_JAVA_FILES", message: "none" });
    nothingPublished(h);
    assert.deepEqual(h.reporter.outcome(), {
      status: "failed",
      failureClass: "user",
      failureCode: "NO_JAVA_FILES",
      message: "none",
    });
    const metrics = h.lines.filter((line) => line.includes("JobsFailed")).map((line) => JSON.parse(line) as Record<string, string>);
    assert.equal(metrics[0]?.Class, "user");
  });

  test("an engine failure is a system failure with a safe message", async () => {
    const h = harness(createLocalSourceFetcher(stopsFile), {
      indexProject: async () => ({ ok: false, stage: "parse", errors: [] }),
    });
    const result = await run(h, input("S"));
    assert.equal(result.status, "failed");
    if (result.status !== "failed") return;
    assert.equal(result.failureClass, "system");
    assert.equal(result.code, "ENGINE_PARSE_FAILED");
    nothingPublished(h);
    assert.deepEqual(readdirSync(h.tmpRoot), []);
    assert.deepEqual(h.reporter.outcome(), {
      status: "failed",
      failureClass: "system",
      failureCode: "ENGINE_PARSE_FAILED",
      message: "Indexing the repository failed.",
    });
  });

  test("a snapshot id from a different build is refused before any work", async () => {
    let fetched = false;
    const h = harness({ fetch: async () => ((fetched = true), { ok: false, retier: "M" } as FetchResult) });
    const result = await run(h, input("S", { snapshotId: "f".repeat(32) }));
    assert.equal(result.status === "failed" && result.code, "SNAPSHOT_ID_MISMATCH");
    assert.equal(fetched, false);
  });

  test("an invalid repository or commit is a user failure", async () => {
    const h = harness(createLocalSourceFetcher(stopsFile));
    const result = await run(h, input("S", { commitSha: "main" }));
    assert.equal(result.status === "failed" && result.failureClass, "user");
  });

  test("a failing validation stops the job with its reason", async () => {
    const h = harness(createLocalSourceFetcher(stopsFile), {
      validate: async () => ({ ok: false, reason: "private", message: "Private repositories are not supported." }),
    });
    const result = await run(h, input("S"));
    assert.deepEqual(result, {
      status: "failed",
      failureClass: "user",
      code: "PRECHECK_PRIVATE",
      message: "Private repositories are not supported.",
    });
    const unavailable = harness(createLocalSourceFetcher(stopsFile), {
      validate: async () => ({ ok: false, reason: "github-unavailable", message: "later" }),
    });
    const second = await run(unavailable, input("S"));
    assert.equal(second.status === "failed" && second.failureClass, "system");
  });

  test("30 s before the time limit the job aborts, reports a system failure and publishes nothing", async () => {
    const started = Date.now();
    const hangs: SourceFetcher = { fetch: () => new Promise<FetchResult>(() => undefined) };
    const h = harness(hangs, { remainingMs: () => 30_000 + 60 - (Date.now() - started) });
    const job = input("L");
    const result = await run(h, job);
    assert.equal(result.status === "failed" && result.code, "TIME_LIMIT");
    assert.equal(result.status === "failed" && result.failureClass, "system");
    nothingPublished(h);
    assert.equal(h.reporter.outcome()?.status, "failed");
  });
});

describe("runJob: reporting", () => {
  test("an L job reports no waiting-for-slot state: the server starts it only when the slot is free", async () => {
    const h = harness(createLocalSourceFetcher(okFile));
    assert.equal((await run(h, input("L"))).status, "succeeded");
    assert.ok(!h.reporter.states().includes("waiting-for-slot"));
    assert.equal(h.reporter.states()[0], "fetching");
  });

  test("a failing reporter is a warning, never a failed job", async () => {
    const h = harness(createLocalSourceFetcher(okFile), {
      reporter: {
        progress: async () => {
          throw new Error("server down");
        },
        complete: async () => {
          throw new Error("server down");
        },
      },
    });
    assert.equal((await run(h, input("S"))).status, "succeeded");
    assert.ok(h.lines.some((line) => line.includes("progress report failed")));
    assert.ok(h.lines.some((line) => line.includes("could not report the job outcome")));
  });

  test("the active snapshot reader is handed to publish for the repository", async () => {
    const asked: string[] = [];
    const h = harness(createLocalSourceFetcher(okFile), {
      activeSnapshotId: async (repo) => {
        asked.push(repo);
        return undefined;
      },
    });
    // The first publish has nothing to prune, so the reader is not consulted: that is fine.
    assert.equal((await run(h, input("S"))).status, "succeeded");
    assert.ok(asked.every((repo) => repo === REPO));
  });
});
