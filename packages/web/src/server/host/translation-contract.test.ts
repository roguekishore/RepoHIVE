/**
 * Contract tests for the TS translation layer. The browser client is pointed at this server's
 * real route handlers (no mock of a response body), so a change to an endpoint's shape, status or wording that the
 * client does not understand fails here and not in a browser.
 *
 * Not covered: an accepted or cached index request (that starts or finds a real job; `scripts/e2e.mjs` runs
 * it) and the Java host.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildLatest,
  buildManifest,
  createLocalArtifactStore,
  createMemoryArtifactStore,
  createMemoryJobLedger,
  jsonBytes,
  prepareObject,
  latestKey,
  manifestKey,
  viewKey,
  VIEW_FILES,
  type JobInput,
  type JobLedger,
} from "@repohive/indexer";
import type { ContractClient, JobEvent } from "@repohive/design/contracts";
import { GET as sessionGet } from "@/app/api/auth/session/route";
import { POST as signInPost } from "@/app/api/auth/sign-in/route";
import { POST as signOutPost } from "@/app/api/auth/sign-out/route";
import { POST as signUpPost } from "@/app/api/auth/sign-up/route";
import { POST as indexPost } from "@/app/api/index/route";
import { GET as jobGet } from "@/app/api/jobs/[jobId]/route";
import { GET as jobEventsGet } from "@/app/api/jobs/[jobId]/events/route";
import { GET as quotaGet } from "@/app/api/quota/route";
import { GET as reposGet } from "@/app/api/repos/route";
import { GET as repoGet } from "@/app/api/repos/[owner]/[repo]/route";
import { GET as latestGet } from "@/app/r/[...path]/route";
import { GET as snapshotGet } from "@/app/s/[...path]/route";
import { createBrowserClient } from "@/features/host/browser-client";
import { loadSnapshotState } from "@/features/host/snapshot-state";
import { openAppDatabase, resetAppDatabaseForTests } from "@/server/app-db/database";
import { resetHostingClientsForTests } from "@/server/hosting/clients";
import { resetAppConfigForTests } from "@/server/hosting/config";
import { resetJobEventStreamRegistryForTests } from "@/server/jobs/stream-registry";
import { upsertIndexedRepository } from "@/server/worker/repositories";

const ORIGIN = "http://localhost:3000";
const SNAPSHOT = "0123456789abcdef0123456789abcdef";
const COMMIT = "c".repeat(40);
const REPO = "github.com/acme/widgets";

let scratch: string;
let db: ReturnType<typeof openAppDatabase>;
let ledger: JobLedger;
let client: ContractClient;
let cookie = "";

type PathParams = { params: Promise<{ path: string[] }> };

/** Routes a path to the handler a deployment would, keeping a cookie jar like a browser. */
async function viaHandlers(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), ORIGIN);
  const headers = new Headers(init?.headers);
  if (cookie !== "") headers.set("Cookie", cookie);
  const request = new Request(url, { ...init, headers });
  const path = url.pathname;
  const post = init?.method === "POST";

  const response = await (async (): Promise<Response> => {
    if (path === "/api/auth/session") return sessionGet(request);
    if (path === "/api/auth/sign-in" && post) return signInPost(request);
    if (path === "/api/auth/sign-up" && post) return signUpPost(request);
    if (path === "/api/auth/sign-out" && post) return signOutPost(request);
    if (path === "/api/quota") return quotaGet(request);
    if (path === "/api/index" && post) return indexPost(request);
    if (path === "/api/repos") return reposGet(request);
    const events = /^\/api\/jobs\/([^/]+)\/events$/.exec(path);
    if (events !== null) return jobEventsGet(request, { params: Promise.resolve({ jobId: decodeURIComponent(events[1] ?? "") }) });
    const job = /^\/api\/jobs\/([^/]+)$/.exec(path);
    if (job !== null) return jobGet(request, { params: Promise.resolve({ jobId: decodeURIComponent(job[1] ?? "") }) });
    const repo = /^\/api\/repos\/([^/]+)\/([^/]+)$/.exec(path);
    if (repo !== null) return repoGet(request, { params: Promise.resolve({ owner: repo[1] ?? "", repo: repo[2] ?? "" }) });
    const segments = (prefix: string): PathParams => ({ params: Promise.resolve({ path: path.slice(prefix.length).split("/") }) });
    if (path.startsWith("/r/")) return latestGet(request, segments("/r/"));
    if (path.startsWith("/s/")) return snapshotGet(request, segments("/s/"));
    throw new Error(`no handler for ${path}`);
  })();

  const set = response.headers.getSetCookie?.() ?? [];
  if (set.length > 0) {
    const pair = (set[0] ?? "").split(";")[0] ?? "";
    cookie = pair.endsWith("=") ? "" : pair;
  }
  return response;
}

/** An `EventSource` over a handler's real stream: parses the frames it writes and dispatches them. */
class HandlerEventSource {
  onerror: ((event: Event) => void) | null = null;
  private readonly listeners = new Map<string, (event: Event) => void>();
  private closed = false;

  constructor(url: string) {
    const headers = { "X-Forwarded-For": `10.1.0.${Math.floor(Math.random() * 200) + 1}` };
    void (async () => {
      const response = await viaHandlers(url, { headers });
      const reader = response.body?.getReader();
      if (reader === undefined) return;
      let buffer = "";
      while (!this.closed) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += new TextDecoder().decode(chunk.value);
        for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.*)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (event !== undefined && data !== undefined) this.listeners.get(event)?.({ data } as unknown as Event);
        }
      }
      await reader.cancel();
    })();
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, listener);
  }

  close(): void {
    this.closed = true;
  }
}

/** One repository per job: the ledger holds a lock per repository, so two live jobs cannot share one. */
const jobRepo = (jobId: string): string => `github.com/acme/${jobId}`;

function jobInput(jobId: string): JobInput {
  return {
    jobId,
    accountId: "1",
    repo: jobRepo(jobId),
    commitSha: COMMIT,
    tier: "S",
    snapshotId: SNAPSHOT,
    visibility: "public",
  };
}

function watch(jobId: string): Promise<JobEvent[]> {
  return new Promise((resolve, reject) => {
    const events: JobEvent[] = [];
    const stop = client.watchJob(
      jobId,
      (event) => {
        events.push(event);
        if (event.event === "done") resolve(events);
      },
      reject,
    );
    setTimeout(() => {
      stop();
      reject(new Error(`no done event; saw ${JSON.stringify(events)}`));
    }, 5000);
  });
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "repohive-contract-"));
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("REPOHIVE_")) delete process.env[key];
  }
  Object.assign(process.env, {
    REPOHIVE_MODE: "local",
    REPOHIVE_SITE_ORIGIN: ORIGIN,
    REPOHIVE_DATA_DIR: join(scratch, "data"),
    REPOHIVE_STORE: `local:${join(scratch, "store")}`,
    REPOHIVE_LEDGER: `file:${join(scratch, "ledger.json")}`,
    REPOHIVE_ORCHESTRATOR: "local",
  });
  resetAppConfigForTests();
  resetJobEventStreamRegistryForTests();
  db = openAppDatabase(join(scratch, "app.sqlite"));
  resetAppDatabaseForTests(db);
  ledger = createMemoryJobLedger();
  resetHostingClientsForTests(createMemoryArtifactStore(), ledger);

  upsertIndexedRepository(db, {
    repo: REPO,
    snapshotId: SNAPSHOT,
    commitSha: COMMIT,
    indexedAt: "2026-10-07T00:00:00.000Z",
    nodeCount: 42,
    jobId: "job-seed",
  });

  // What the indexer publishes, stored with the headers it gives each key, in the store the routes read.
  const store = createLocalArtifactStore(join(scratch, "store"));
  const put = async (key: string, body: unknown): Promise<void> => {
    const prepared = await prepareObject({ key, content: jsonBytes(body) });
    await store.put(key, prepared.body, prepared.headers);
  };
  const fields = { repo: REPO, commitSha: COMMIT, engineVersion: "e1", viewsVersion: "v1" };
  await put(latestKey(REPO), buildLatest({ ...fields, snapshotId: SNAPSHOT }, new Date("2026-10-07T00:00:00.000Z")));
  const view = { totalNodes: 42 };
  await put(viewKey(SNAPSHOT, VIEW_FILES.hierarchyScale), view);
  await put(
    manifestKey(SNAPSHOT),
    buildManifest({ ...fields, indexFormatVersion: 1 }, [
      { key: viewKey(SNAPSHOT, VIEW_FILES.hierarchyScale), content: jsonBytes(view) },
    ]),
  );

  client = createBrowserClient({
    fetch: viaHandlers as typeof fetch,
    origin: () => ORIGIN,
    openEventSource: (url) => new HandlerEventSource(url) as unknown as EventSource,
  });
});

afterAll(() => {
  db.close();
  resetAppDatabaseForTests();
  resetHostingClientsForTests();
  rmSync(scratch, { recursive: true, force: true });
});

describe("account, against the real handlers", () => {
  const credentials = { email: "reader@example.com", password: "password-ten-chars" };

  it("starts signed out, with no allowance to show", async () => {
    expect(await client.session()).toEqual({ signedIn: false });
    expect(await client.quota()).toBeUndefined();
  });

  it("refuses a short password with the server's own code and words", async () => {
    const result = await client.signUp({ email: credentials.email, password: "short" });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_PASSWORD" } });
    expect(result.ok === false && result.error.message.length).toBeGreaterThan(0);
  });

  it("signs up, reads the session and the allowance, signs out, signs in again", async () => {
    expect(await client.signUp(credentials)).toEqual({ ok: true });
    expect(await client.session()).toEqual({ signedIn: true, email: credentials.email });
    const quota = await client.quota();
    expect(quota).toEqual({
      remainingAccount: expect.any(Number),
      remainingIp: expect.any(Number),
      limitAccount: expect.any(Number),
      limitIp: expect.any(Number),
    });
    expect(quota?.remainingAccount).toBeLessThanOrEqual(quota?.limitAccount ?? 0);

    expect(await client.signOut()).toEqual({ ok: true });
    expect(await client.session()).toEqual({ signedIn: false });
    expect(await client.signIn({ ...credentials, password: "wrong-password-10" })).toMatchObject({
      ok: false,
      error: { code: "SIGNIN_REJECTED", message: "Invalid email or password." },
    });
    expect(await client.signIn(credentials)).toEqual({ ok: true });
    expect(await client.session()).toMatchObject({ signedIn: true });
  });

  it("answers an index request for a reference it cannot use as rejected, signed in or out", async () => {
    const signedIn = await client.requestIndex("not a repository");
    expect(signedIn.status).toBe("rejected");
    await client.signOut();
    expect(await client.requestIndex("acme/widgets")).toMatchObject({ status: "rejected", code: "UNAUTHENTICATED" });
    await client.signIn(credentials);
  });
});

describe("repositories, against the real handlers", () => {
  it("lists the indexed repositories in the contract's page shape", async () => {
    expect(await client.listRepositories()).toEqual({
      items: [
        {
          repoKey: REPO,
          repoId: "acme/widgets",
          snapshotId: SNAPSHOT,
          commitSha: COMMIT,
          indexedAt: "2026-10-07T00:00:00.000Z",
          nodeCount: 42,
        },
      ],
      page: 1,
      totalPages: 1,
      total: 1,
    });
    expect((await client.listRepositories(9)).page).toBe(1);
  });

  it("reads one repository, in any letter case, and answers undefined for one never indexed", async () => {
    const expected = { repo: "acme/widgets", snapshotId: SNAPSHOT, commitSha: COMMIT, nodeCount: 42, indexedAt: "2026-10-07T00:00:00.000Z" };
    expect(await client.repository("acme", "widgets")).toEqual(expected);
    expect(await client.repository("ACME", "Widgets")).toEqual(expected);
    expect(await client.repository("acme", "nope")).toBeUndefined();
    expect(await client.repository("bad_owner", "widgets")).toBeUndefined();
  });

  it("is never cached by a browser or a CDN", async () => {
    for (const path of ["/api/repos", "/api/repos/acme/widgets", "/api/repos/acme/nope"]) {
      expect((await viaHandlers(path)).headers.get("cache-control"), path).toBe("no-store");
    }
  });
});

describe("snapshots, against the real handlers", () => {
  it("reads the pointer, the manifest and a view the indexer published", async () => {
    expect(await client.snapshotPointer("acme", "widgets")).toEqual({
      snapshotId: SNAPSHOT,
      commitSha: COMMIT,
      engineVersion: "e1",
      viewsVersion: "v1",
      publishedAt: "2026-10-07T00:00:00.000Z",
    });
    const manifest = await client.manifest(SNAPSHOT);
    expect(manifest).toMatchObject({ repo: REPO, commitSha: COMMIT, indexFormatVersion: 1 });
    expect(manifest?.files.map((file) => file.key)).toEqual([viewKey(SNAPSHOT, VIEW_FILES.hierarchyScale)]);
    expect(await client.view(SNAPSHOT, "hierarchyScale")).toEqual({ totalNodes: 42 });
  });

  it("answers undefined for a repository or snapshot that is not there, and rejects an unpublished view", async () => {
    expect(await client.snapshotPointer("acme", "nope")).toBeUndefined();
    expect(await client.manifest("f".repeat(32))).toBeUndefined();
    await expect(client.view(SNAPSHOT, "zoomMap")).rejects.toThrow("not published");
  });

  it("resolves a page's snapshot from the real pointer and manifest", async () => {
    expect(await loadSnapshotState(client, "acme", "widgets")).toEqual({
      status: "ready",
      snapshotId: SNAPSHOT,
      source: "latest",
      commitSha: COMMIT,
    });
    expect(await loadSnapshotState(client, "acme", "nope")).toEqual({ status: "never-indexed" });
    expect(await loadSnapshotState(client, "acme", "widgets", SNAPSHOT)).toEqual({
      status: "ready",
      snapshotId: SNAPSHOT,
      source: "query",
    });
    expect(await loadSnapshotState(client, "acme", "widgets", "f".repeat(32))).toEqual({
      status: "expired",
      requested: "f".repeat(32),
    });
  });
});

describe("jobs, against the real handlers", () => {
  it("reads a running job with its progress", async () => {
    await ledger.claim(jobInput("running"));
    await ledger.transition("running", "parsing");
    await ledger.writeProgress("running", { stage: "parsing", completed: 2, total: 10 });
    expect(await client.job("running")).toEqual({
      repo: jobRepo("running"),
      state: "parsing",
      progress: { stage: "parsing", completed: 2, total: 10 },
    });
  });

  it("reads a finished job with its snapshot", async () => {
    await ledger.claim(jobInput("finished"));
    await ledger.finish("finished", { state: "succeeded" });
    expect(await client.job("finished")).toEqual({ repo: jobRepo("finished"), state: "succeeded", result: { snapshotId: SNAPSHOT } });
  });

  it("reads a failed job without presenting its code as a sentence", async () => {
    await ledger.claim(jobInput("failed"));
    await ledger.finish("failed", { state: "failed", failureClass: "user", failureCode: "REPO_TOO_LARGE" });
    expect(await client.job("failed")).toEqual({ repo: jobRepo("failed"), state: "failed", failure: { code: "REPO_TOO_LARGE" } });
  });

  it("answers undefined for a job the ledger does not know", async () => {
    expect(await client.job("nobody")).toBeUndefined();
  });

  it("follows the real event stream of a finished job to done", async () => {
    const events = await watch("finished");
    expect(events.at(-1)).toEqual({
      event: "done",
      data: { jobId: "finished", repo: jobRepo("finished"), state: "succeeded", result: { snapshotId: SNAPSHOT } },
    });
  });

  it("follows the real stream of a failed job, and of an unknown one", async () => {
    expect((await watch("failed")).at(-1)).toMatchObject({
      event: "done",
      data: { jobId: "failed", state: "failed", failure: { code: "REPO_TOO_LARGE" } },
    });
    expect((await watch("nobody")).at(-1)).toEqual({
      event: "done",
      data: { jobId: "nobody", repo: "", state: "failed", failure: { code: "NOT_FOUND" } },
    });
  });

  it("reads progress frames of a running job", async () => {
    const first = await new Promise<JobEvent>((resolve, reject) => {
      const stop = client.watchJob(
        "running",
        (event) => {
          stop();
          resolve(event);
        },
        reject,
      );
      setTimeout(() => reject(new Error("no progress frame")), 5000);
    });
    expect(first).toEqual({
      event: "progress",
      data: { jobId: "running", repo: jobRepo("running"), state: "parsing", progress: { stage: "parsing", completed: 2, total: 10 } },
    });
  });
});
