/**
 * The compiled local-job child against an in-process fake server and a temporary store.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { engineVersion } from "@repohive/engine";
import { getViewsVersion } from "@repohive/views";
import { createLocalArtifactStore } from "./artifact-store-local.js";
import { hostedConfigDigest } from "./hosted-options.js";
import { isForwardJobTransition } from "./job-states.js";
import type { JobInput, JobState } from "./job-types.js";
import { snapshotIdOf, type Manifest } from "./layout.js";
import { ensureFixtureTarball } from "./local-fixtures.js";

const script = fileURLToPath(new URL("./local-job.js", import.meta.url));
const SECRET = "local-job-test-secret";
const REPO = "github.com/local/sample-java-project";

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: Record<string, unknown> | undefined;
}

const scratch = mkdtempSync(join(tmpdir(), "repohive-local-job-"));
const tarballs = join(scratch, "tarballs");
let server: Server;
let serverUrl = "";
let seen: Seen[] = [];
let commitSha = "";

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

before(async () => {
  commitSha = ensureFixtureTarball("sample-java-project", tarballs).commitSha;
  server = createServer((request, response) => {
    void readBody(request).then((text) => {
      seen.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization,
        body: text === "" ? undefined : (JSON.parse(text) as Record<string, unknown>),
      });
      if (request.method === "GET") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ snapshotId: null }));
      } else {
        response.writeHead(204);
        response.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  serverUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(scratch, { recursive: true, force: true });
});

function jobInput(): JobInput {
  return {
    jobId: `job-${Math.random().toString(36).slice(2)}`,
    accountId: "1",
    repo: REPO,
    commitSha,
    tier: "S",
    snapshotId: snapshotIdOf({
      repo: REPO,
      commitSha,
      engineVersion,
      viewsVersion: getViewsVersion(),
      configDigest: hostedConfigDigest(),
    }),
    visibility: "public",
  };
}

function exec(input: JobInput, store: string, extra: NodeJS.ProcessEnv = {}): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [script],
      {
        env: {
          ...process.env,
          REPOHIVE_JOB_INPUT: JSON.stringify(input),
          REPOHIVE_STORE: `local:${store}`,
          REPOHIVE_SERVER_URL: serverUrl,
          REPOHIVE_INTERNAL_SECRET: SECRET,
          REPOHIVE_TARBALL_DIR: tarballs,
          ...extra,
        },
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, _stdout, stderr) => {
        resolve({ code: error === null ? 0 : ((error as { code?: number }).code ?? 1), stderr });
      },
    );
  });
}

describe("local-job", () => {
  test("runs the fixture, reports in forward order and publishes under the new layout", async () => {
    seen = [];
    const input = jobInput();
    const store = join(scratch, "store-ok");
    const { code, stderr } = await exec(input, store);
    assert.equal(code, 0, stderr);

    assert.ok(seen.length > 0);
    assert.ok(seen.every((call) => call.authorization === `Bearer ${SECRET}`));
    const posts = seen.filter((call) => call.method === "POST");
    assert.ok(posts.every((call) => call.body?.jobId === input.jobId));

    const states = posts
      .filter((call) => call.url === "/api/internal/jobs/progress")
      .flatMap((call) => (typeof call.body?.state === "string" ? [call.body.state as JobState] : []));
    assert.deepEqual(states, ["fetching", "parsing", "grouping", "building-views", "publishing"]);
    for (let i = 1; i < states.length; i += 1) {
      assert.ok(isForwardJobTransition(states[i - 1]!, states[i]!));
    }

    const completes = posts.filter((call) => call.url === "/api/internal/jobs/complete");
    assert.equal(completes.length, 1);
    assert.equal(posts.at(-1), completes[0], "complete is the last POST");
    const done = completes[0]!.body!;
    assert.equal(done.status, "succeeded");
    assert.equal(done.snapshotId, input.snapshotId);
    assert.equal(done.commitSha, commitSha);
    assert.equal(done.engineVersion, engineVersion);
    assert.equal(done.viewsVersion, getViewsVersion());
    assert.ok(Number(done.nodeCount) > 0 && Number(done.edgeCount) > 0);

    // The prune check asked the active endpoint only if there was something to prune; it is allowed either way.
    assert.ok(seen.filter((call) => call.method === "GET").every((call) => call.url === "/api/internal/repos/local/sample-java-project/active"));

    const keys = await createLocalArtifactStore(store).list("");
    const a = `artifacts/local/sample-java-project/${input.snapshotId}/`;
    const p = `private/local/sample-java-project/${input.snapshotId}/index/`;
    assert.ok(keys.includes(`${a}manifest.json`));
    assert.ok(keys.includes(`${a}views/repo.json`));
    assert.ok(keys.some((key) => key.startsWith(p)));
    assert.ok(keys.includes("private/local/sample-java-project/history.json"));
    assert.ok(keys.every((key) => key.startsWith("artifacts/local/sample-java-project/") || key.startsWith("private/local/sample-java-project/")));
    const manifestObject = (await createLocalArtifactStore(store).get(`${a}manifest.json`))!;
    const manifest = JSON.parse(brotliDecompressSync(manifestObject.body).toString("utf8")) as Manifest;
    assert.equal(manifest.repo, REPO);
    assert.ok(manifest.files.every((file) => file.key.startsWith(a) || file.key.startsWith(p)));
  });

  test("REPOHIVE_LOCAL_JOB_INJECT_FAILURE=system reports E2E_INJECT and exits 1", async () => {
    seen = [];
    const input = jobInput();
    const store = join(scratch, "store-inject");
    const { code } = await exec(input, store, { REPOHIVE_LOCAL_JOB_INJECT_FAILURE: "system" });
    assert.equal(code, 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.url, "/api/internal/jobs/complete");
    assert.deepEqual(seen[0]?.body, {
      jobId: input.jobId,
      status: "failed",
      failureClass: "system",
      failureCode: "E2E_INJECT",
      message: "Injected failure.",
    });
    assert.deepEqual(await createLocalArtifactStore(store).list(""), []);
  });

  test("a missing variable is a crash that names it, never the secret", async () => {
    const { code, stderr } = await exec(jobInput(), join(scratch, "x"), { REPOHIVE_TARBALL_DIR: "" });
    assert.equal(code, 1);
    assert.match(stderr, /REPOHIVE_TARBALL_DIR is not set/);
    assert.ok(!stderr.includes(SECRET));
    const bad = await exec(jobInput(), join(scratch, "x"), { REPOHIVE_STORE: "s3:bucket" });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /REPOHIVE_STORE must be local:<dir>/);
  });
});
