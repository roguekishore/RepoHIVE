// @vitest-environment node
import { VIEW_FILES, architectureLevelKey, regionDetailKey } from "@repohive/indexer";
import { describe, expect, it, vi } from "vitest";
import {
  REGION_DETAIL_INDEX_PATH,
  VIEW_PATHS,
  architectureLevelPath,
  createBrowserClient,
  regionDetailPath,
} from "./browser-client";

const SNAPSHOT = "0123456789abcdef0123456789abcdef";

interface Call {
  readonly url: string;
  readonly init?: RequestInit;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** A fetch that answers from a table of `path -> response`, recording every call. */
function fakeFetch(table: Record<string, () => Response>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const answer = table[url];
    if (answer === undefined) throw new Error(`unexpected request: ${url}`);
    return answer();
  }) as typeof fetch;
  return { fetch: impl, calls };
}

function clientFor(table: Record<string, () => Response>, origin = "http://site.test") {
  const { fetch, calls } = fakeFetch(table);
  return { client: createBrowserClient({ fetch, origin: () => origin }), calls };
}

describe("snapshot paths", () => {
  it("name the views the indexer publishes, under the same keys", () => {
    for (const [name, path] of Object.entries(VIEW_PATHS)) {
      expect(path, name).toBe(VIEW_FILES[name as keyof typeof VIEW_FILES]);
    }
    expect(REGION_DETAIL_INDEX_PATH).toBe(VIEW_FILES.regionDetailIndex);
    expect(`s/${SNAPSHOT}/${architectureLevelPath(3)}`).toBe(architectureLevelKey(SNAPSHOT, 3));
    expect(`s/${SNAPSHOT}/${regionDetailPath(12)}`).toBe(regionDetailKey(SNAPSHOT, 12));
  });
});

describe("session and account actions", () => {
  it("reads the session, and reads anything it cannot reach as signed out", async () => {
    const ok = clientFor({ "/api/auth/session": () => json({ signedIn: true, email: "a@b.test" }) });
    expect(await ok.client.session()).toEqual({ signedIn: true, email: "a@b.test" });

    const out = clientFor({ "/api/auth/session": () => json({ signedIn: false }) });
    expect(await out.client.session()).toEqual({ signedIn: false });

    const broken = clientFor({ "/api/auth/session": () => json({ code: "X" }, 500) });
    expect(await broken.client.session()).toEqual({ signedIn: false });

    const offline = createBrowserClient({ fetch: () => Promise.reject(new Error("offline")) });
    expect(await offline.session()).toEqual({ signedIn: false });
  });

  it("posts credentials with the site origin and answers ok", async () => {
    const { client, calls } = clientFor({ "/api/auth/sign-in": () => json({ ok: true }) });
    expect(await client.signIn({ email: "a@b.test", password: "pw" })).toEqual({ ok: true });
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({ Origin: "http://site.test", "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ email: "a@b.test", password: "pw" });
  });

  it("turns a refusal into the server's code and message, and a bare failure into a generic one", async () => {
    const refused = clientFor({
      "/api/auth/sign-up": () => json({ code: "EMAIL_TAKEN", message: "That email is registered." }, 409),
    });
    expect(await refused.client.signUp({ email: "a@b.test", password: "pw" })).toEqual({
      ok: false,
      error: { code: "EMAIL_TAKEN", message: "That email is registered." },
    });

    const bare = clientFor({ "/api/auth/sign-out": () => new Response("<html>", { status: 502 }) });
    expect(await bare.client.signOut()).toEqual({
      ok: false,
      error: { code: "REQUEST_FAILED", message: "The request failed." },
    });
  });

  it("sends sign-out without a body", async () => {
    const { client, calls } = clientFor({ "/api/auth/sign-out": () => json({ ok: true }) });
    await client.signOut();
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it("rejects, rather than answering, when the network fails", async () => {
    const client = createBrowserClient({ fetch: () => Promise.reject(new Error("offline")), origin: () => "x" });
    await expect(client.signIn({ email: "a", password: "b" })).rejects.toThrow("offline");
  });
});

describe("quota", () => {
  it("is undefined when signed out and the four counts when signed in", async () => {
    const out = clientFor({ "/api/quota": () => json({ code: "UNAUTHENTICATED", message: "Sign in." }, 401) });
    expect(await out.client.quota()).toBeUndefined();

    const body = { remainingAccount: 3, remainingIp: 8, limitAccount: 5, limitIp: 10 };
    const signedIn = clientFor({ "/api/quota": () => json({ ...body, extra: 1 }) });
    expect(await signedIn.client.quota()).toEqual(body);
  });

  it("rejects an answer it cannot read", async () => {
    await expect(clientFor({ "/api/quota": () => json({ remainingAccount: "3" }) }).client.quota()).rejects.toThrow();
    await expect(clientFor({ "/api/quota": () => json({ message: "down" }, 500) }).client.quota()).rejects.toThrow("down");
  });
});

describe("requestIndex", () => {
  const post = (response: () => Response) => clientFor({ "/api/index": response }).client.requestIndex("acme/widgets");

  it("maps each outcome", async () => {
    expect(await post(() => json({ status: "accepted", jobId: "j1" }, 202))).toEqual({ status: "accepted", jobId: "j1" });
    expect(await post(() => json({ status: "joined", jobId: "j2" }, 200))).toEqual({ status: "joined", jobId: "j2" });
    expect(await post(() => json({ status: "cached", repo: "github.com/acme/widgets", snapshotId: SNAPSHOT }))).toEqual({
      status: "cached",
      repo: "github.com/acme/widgets",
      snapshotId: SNAPSHOT,
    });
    expect(await post(() => json({ status: "rejected", code: "NOT_FOUND", message: "No such repository." }, 404))).toEqual({
      status: "rejected",
      code: "NOT_FOUND",
      message: "No such repository.",
    });
  });

  it("reads the wait from the body, then the header, then a default", async () => {
    expect(await post(() => json({ status: "busy", retryAfterSeconds: 30 }, 503))).toEqual({ status: "busy", retryAfterSeconds: 30 });
    expect(await post(() => json({ status: "busy" }, 503, { "Retry-After": "45" }))).toEqual({ status: "busy", retryAfterSeconds: 45 });
    expect(await post(() => json({ status: "busy" }, 503))).toEqual({ status: "busy", retryAfterSeconds: 120 });
  });

  it("calls a signed-out request rejected, never accepted, whatever the body says", async () => {
    expect(await post(() => json({ code: "UNAUTHENTICATED", message: "Sign in to request an index." }, 401))).toEqual({
      status: "rejected",
      code: "UNAUTHENTICATED",
      message: "Sign in to request an index.",
    });
    expect(await post(() => json({ status: "accepted", jobId: "j" }, 401))).toMatchObject({ status: "rejected" });
  });

  it("calls an answer it does not recognise rejected, with the server's words when it has them", async () => {
    expect(await post(() => json({ code: "BAD_REQUEST", message: "Expected a repository reference." }, 400))).toEqual({
      status: "rejected",
      code: "BAD_REQUEST",
      message: "Expected a repository reference.",
    });
    expect(await post(() => json({ status: "accepted" }, 202))).toMatchObject({ status: "rejected", code: "REQUEST_FAILED" });
  });

  it("sends the repository as the body", async () => {
    const { client, calls } = clientFor({ "/api/index": () => json({ status: "accepted", jobId: "j" }, 202) });
    await client.requestIndex("acme/widgets");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ repo: "acme/widgets" });
  });
});

describe("job", () => {
  it("maps a running job with its progress", async () => {
    const { client } = clientFor({
      "/api/jobs/j%2F1": () =>
        json({ repo: "github.com/acme/widgets", state: "parsing", progress: { stage: "parsing", completed: 2, total: 10 } }),
    });
    expect(await client.job("j/1")).toEqual({
      repo: "github.com/acme/widgets",
      state: "parsing",
      progress: { stage: "parsing", completed: 2, total: 10 },
    });
  });

  it("carries the snapshot of a finished job", async () => {
    const { client } = clientFor({
      "/api/jobs/j1": () => json({ repo: "github.com/a/b", state: "succeeded", result: { snapshotId: SNAPSHOT } }),
    });
    expect(await client.job("j1")).toEqual({ repo: "github.com/a/b", state: "succeeded", result: { snapshotId: SNAPSHOT } });
  });

  it("drops a failure message that only repeats the code", async () => {
    const same = clientFor({
      "/api/jobs/j1": () => json({ repo: "r", state: "failed", failure: { code: "PARSE_ERROR", message: "PARSE_ERROR" } }),
    });
    expect(await same.client.job("j1")).toEqual({ repo: "r", state: "failed", failure: { code: "PARSE_ERROR" } });

    const worded = clientFor({
      "/api/jobs/j1": () => json({ repo: "r", state: "failed", failure: { code: "TOO_BIG", message: "Over the limit." } }),
    });
    expect(await worded.client.job("j1")).toEqual({
      repo: "r",
      state: "failed",
      failure: { code: "TOO_BIG", message: "Over the limit." },
    });
  });

  it("is undefined for an unknown job and rejects a state it does not know", async () => {
    expect(await clientFor({ "/api/jobs/x": () => json({ code: "NOT_FOUND" }, 404) }).client.job("x")).toBeUndefined();
    await expect(clientFor({ "/api/jobs/x": () => json({ repo: "r", state: "dancing" }) }).client.job("x")).rejects.toThrow();
    await expect(clientFor({ "/api/jobs/x": () => json({}, 500) }).client.job("x")).rejects.toThrow("500");
  });
});

class FakeEventSource {
  readonly listeners = new Map<string, (event: Event) => void>();
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, listener);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: string): void {
    this.listeners.get(type)?.({ data } as unknown as Event);
  }
  fail(): void {
    this.onerror?.({} as Event);
  }
}

describe("watchJob", () => {
  function watch() {
    const source = { current: undefined as FakeEventSource | undefined };
    const client = createBrowserClient({
      fetch: (() => Promise.reject(new Error("no fetch"))) as typeof fetch,
      openEventSource: (url) => {
        source.current = new FakeEventSource(url);
        return source.current as unknown as EventSource;
      },
    });
    const events: unknown[] = [];
    const errors: Error[] = [];
    const stop = client.watchJob("j/1", (event) => events.push(event), (error) => errors.push(error));
    return { source: source.current as FakeEventSource, events, errors, stop };
  }

  it("follows progress to done, then closes the stream", () => {
    const { source, events, errors } = watch();
    expect(source.url).toBe("/api/jobs/j%2F1/events");
    source.emit("progress", JSON.stringify({ jobId: "j/1", repo: "r", state: "parsing", progress: { stage: "parsing", completed: 1 } }));
    source.emit("done", JSON.stringify({ jobId: "j/1", repo: "r", state: "succeeded", result: { snapshotId: SNAPSHOT } }));
    expect(events).toEqual([
      { event: "progress", data: { jobId: "j/1", repo: "r", state: "parsing", progress: { stage: "parsing", completed: 1 } } },
      { event: "done", data: { jobId: "j/1", repo: "r", state: "succeeded", result: { snapshotId: SNAPSHOT } } },
    ]);
    expect(source.closed).toBe(true);
    // The server closes its end after `done`, which the browser reports as an error. That is not one.
    source.fail();
    expect(errors).toEqual([]);
  });

  it("accepts the done frame of an unknown job, which names no repository", () => {
    const { source, events } = watch();
    source.emit("done", JSON.stringify({ jobId: "j/1", state: "failed", failure: { code: "NOT_FOUND" } }));
    expect(events).toEqual([
      { event: "done", data: { jobId: "j/1", repo: "", state: "failed", failure: { code: "NOT_FOUND" } } },
    ]);
  });

  it("skips a frame it cannot read and keeps listening", () => {
    const { source, events } = watch();
    source.emit("progress", "not json");
    source.emit("progress", JSON.stringify({ state: "nonsense" }));
    expect(events).toEqual([]);
    expect(source.closed).toBe(false);
  });

  it("reports a stream that breaks before done, once, and stops", () => {
    const { source, errors } = watch();
    source.fail();
    source.fail();
    expect(errors).toHaveLength(1);
    expect(source.closed).toBe(true);
  });

  it("stops when asked, and stays silent afterwards", () => {
    const { source, events, errors, stop } = watch();
    stop();
    source.emit("progress", JSON.stringify({ jobId: "j/1", repo: "r", state: "parsing" }));
    source.fail();
    expect(source.closed).toBe(true);
    expect(events).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("repositories", () => {
  const item = {
    repoKey: "github.com/acme/widgets",
    repoId: "acme/widgets",
    snapshotId: SNAPSHOT,
    commitSha: "c".repeat(40),
    indexedAt: "2026-10-07T00:00:00.000Z",
    nodeCount: 120,
  };

  it("reads a page, asking for the page given and none otherwise", async () => {
    const page = { items: [{ ...item, extra: true }], page: 2, totalPages: 3, total: 120 };
    const { client, calls } = clientFor({ "/api/repos?page=2": () => json(page), "/api/repos": () => json(page) });
    expect(await client.listRepositories(2)).toEqual({ items: [item], page: 2, totalPages: 3, total: 120 });
    await client.listRepositories();
    expect(calls.map((call) => call.url)).toEqual(["/api/repos?page=2", "/api/repos"]);
  });

  it("rejects a page it cannot read", async () => {
    await expect(clientFor({ "/api/repos": () => json({ items: [{ repoKey: 1 }], page: 1, totalPages: 1, total: 1 }) }).client.listRepositories()).rejects.toThrow(
      "not understood",
    );
    await expect(clientFor({ "/api/repos": () => json({}, 500) }).client.listRepositories()).rejects.toThrow("500");
  });

  it("reads one repository, with the edge count only when the host sent one", async () => {
    const base = { repo: "acme/widgets", snapshotId: SNAPSHOT, commitSha: "c".repeat(40), nodeCount: 120, indexedAt: item.indexedAt };
    const without = clientFor({ "/api/repos/acme/widgets": () => json(base) });
    expect(await without.client.repository("acme", "widgets")).toEqual(base);
    const withEdges = clientFor({ "/api/repos/acme/widgets": () => json({ ...base, edgeCount: 900 }) });
    expect(await withEdges.client.repository("acme", "widgets")).toEqual({ ...base, edgeCount: 900 });
  });

  it("is undefined for a repository that was never indexed", async () => {
    const { client } = clientFor({ "/api/repos/acme/nope": () => json({ code: "NOT_FOUND", message: "x" }, 404) });
    expect(await client.repository("acme", "nope")).toBeUndefined();
  });
});

describe("snapshots", () => {
  it("reads the pointer, keeping only the fields it names", async () => {
    const { client } = clientFor({
      "/r/github.com/acme/widgets/latest.json": () =>
        json({ pointerVersion: 1, repo: "github.com/acme/widgets", snapshotId: SNAPSHOT, commitSha: "c".repeat(40), publishedAt: "2026-10-07T00:00:00.000Z" }),
    });
    expect(await client.snapshotPointer("acme", "widgets")).toEqual({
      snapshotId: SNAPSHOT,
      commitSha: "c".repeat(40),
      publishedAt: "2026-10-07T00:00:00.000Z",
    });
  });

  it("is undefined when never indexed and rejects a pointer without a snapshot id", async () => {
    expect(await clientFor({ "/r/github.com/a/b/latest.json": () => json({}, 404) }).client.snapshotPointer("a", "b")).toBeUndefined();
    await expect(
      clientFor({ "/r/github.com/a/b/latest.json": () => json({ snapshotId: "short" }) }).client.snapshotPointer("a", "b"),
    ).rejects.toThrow("malformed");
  });

  it("reads the manifest, and is undefined when the snapshot is gone", async () => {
    const manifest = { manifestVersion: 1, repo: "r", commitSha: "c", engineVersion: "e", viewsVersion: "v", indexFormatVersion: 1, files: [] };
    const { client } = clientFor({
      [`/s/${SNAPSHOT}/manifest.json`]: () => json(manifest),
      [`/s/${"f".repeat(32)}/manifest.json`]: () => json({}, 404),
    });
    expect(await client.manifest(SNAPSHOT)).toEqual(manifest);
    expect(await client.manifest("f".repeat(32))).toBeUndefined();
  });

  it("reads each kind of view from its published object", async () => {
    const { client, calls } = clientFor({
      [`/s/${SNAPSHOT}/views/zoom-map.json`]: () => json({ zoom: true }),
      [`/s/${SNAPSHOT}/views/hierarchy-scale.json`]: () => json({ scale: true }),
      [`/s/${SNAPSHOT}/views/architecture/2.json`]: () => json({ level: 2 }),
      [`/s/${SNAPSHOT}/views/region-detail-index.json`]: () => json({ r: 0 }),
      [`/s/${SNAPSHOT}/views/region-detail/5.json`]: () => json({ region: 5 }),
    });
    expect(await client.view(SNAPSHOT, "zoomMap")).toEqual({ zoom: true });
    expect(await client.view(SNAPSHOT, "hierarchyScale")).toEqual({ scale: true });
    expect(await client.architectureLevel(SNAPSHOT, 2)).toEqual({ level: 2 });
    expect(await client.regionDetailIndex(SNAPSHOT)).toEqual({ r: 0 });
    expect(await client.regionDetail(SNAPSHOT, 5)).toEqual({ region: 5 });
    expect(calls).toHaveLength(5);
  });

  it("says plainly that an unpublished part is not published", async () => {
    const { client } = clientFor({ [`/s/${SNAPSHOT}/views/graph.json`]: () => json({}, 404) });
    await expect(client.view(SNAPSHOT, "graph")).rejects.toThrow("not published");
  });

  it("refuses an id or a position it should never have been given, before any request", async () => {
    const fetch = vi.fn();
    const client = createBrowserClient({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(client.manifest("../x")).rejects.toThrow("snapshot id");
    await expect(client.view("SHORT", "graph")).rejects.toThrow("snapshot id");
    await expect(client.architectureLevel(SNAPSHOT, -1)).rejects.toThrow(RangeError);
    await expect(client.regionDetail(SNAPSHOT, 1.5)).rejects.toThrow(RangeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
