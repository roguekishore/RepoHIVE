/**
 * The snapshot URLs are served from the local store
 * with their stored headers in local mode, and are 404 from the app in hosted
 * mode.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  compressBrotli,
  createLocalArtifactStore,
  createMemoryArtifactStore,
  headersForKey,
  latestKey,
} from "@repohive/indexer";
import { acceptsBrotli, latestPointerKey, serveStoredObject, snapshotObjectKey } from "./snapshot-objects";

const SNAPSHOT = "0123456789abcdef0123456789abcdef";
const VIEW_KEY = `s/${SNAPSHOT}/views/graph.json`;
const LATEST_KEY = latestKey("github.com/local/sample-java-project");
const viewBody = new TextEncoder().encode(JSON.stringify({ nodes: [], links: [] }));

describe("store keys from request paths", () => {
  it("maps /s/<id>/... to the snapshot object key", () => {
    expect(snapshotObjectKey([SNAPSHOT, "views", "graph.json"])).toBe(VIEW_KEY);
    expect(snapshotObjectKey([SNAPSHOT, "views", "architecture", "3.json"])).toBe(`s/${SNAPSHOT}/views/architecture/3.json`);
  });

  it("refuses ids that are not 32 lowercase hex characters and unsafe segments", () => {
    expect(snapshotObjectKey([SNAPSHOT.toUpperCase(), "manifest.json"])).toBeUndefined();
    expect(snapshotObjectKey([SNAPSHOT.slice(1), "manifest.json"])).toBeUndefined();
    expect(snapshotObjectKey([SNAPSHOT])).toBeUndefined();
    expect(snapshotObjectKey([SNAPSHOT, "..", "x"])).toBeUndefined();
    expect(snapshotObjectKey([SNAPSHOT, "a\\b"])).toBeUndefined();
    expect(snapshotObjectKey([])).toBeUndefined();
  });

  it("maps /r/github.com/<owner>/<repo>/latest.json to the latest pointer, and nothing else under /r", () => {
    expect(latestPointerKey(["github.com", "local", "sample-java-project", "latest.json"])).toBe(LATEST_KEY);
    expect(latestPointerKey(["github.com", "local", "sample-java-project", "history.json"])).toBeUndefined();
    expect(latestPointerKey(["github.com", "Local", "sample-java-project", "latest.json"])).toBeUndefined();
    expect(latestPointerKey(["gitlab.com", "local", "sample-java-project", "latest.json"])).toBeUndefined();
    expect(latestPointerKey(["github.com", "local", "..", "latest.json"])).toBeUndefined();
    expect(latestPointerKey(["github.com", "local", "latest.json"])).toBeUndefined();
  });
});

describe("acceptsBrotli", () => {
  it("reads br, the wildcard and q=0", () => {
    expect(acceptsBrotli("gzip, deflate, br, zstd")).toBe(true);
    expect(acceptsBrotli("br;q=0.5")).toBe(true);
    expect(acceptsBrotli("*")).toBe(true);
    expect(acceptsBrotli("gzip, br;q=0")).toBe(false);
    expect(acceptsBrotli("gzip")).toBe(false);
    expect(acceptsBrotli(null)).toBe(false);
  });
});

describe("serveStoredObject", () => {
  it("sends the stored bytes and headers to a client that accepts br", async () => {
    const store = createMemoryArtifactStore();
    const stored = await compressBrotli(viewBody);
    await store.put(VIEW_KEY, stored, headersForKey(VIEW_KEY));
    const response = await serveStoredObject(store, VIEW_KEY, "gzip, br");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(response.headers.get("content-type")).toBe(headersForKey(VIEW_KEY).contentType);
    expect(response.headers.get("cache-control")).toBe(headersForKey(VIEW_KEY).cacheControl);
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.compare(Buffer.from(bytes), stored)).toBe(0);
    expect(brotliDecompressSync(bytes).toString("utf8")).toBe(new TextDecoder().decode(viewBody));
  });

  it("decompresses for a client that does not accept br", async () => {
    const store = createMemoryArtifactStore();
    await store.put(VIEW_KEY, await compressBrotli(viewBody), headersForKey(VIEW_KEY));
    const response = await serveStoredObject(store, VIEW_KEY, "gzip");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe(new TextDecoder().decode(viewBody));
    expect(response.headers.get("content-length")).toBe(String(viewBody.byteLength));
  });

  it("serves the latest pointer with its short cache lifetime", async () => {
    const store = createMemoryArtifactStore();
    await store.put(LATEST_KEY, await compressBrotli(viewBody), headersForKey(LATEST_KEY));
    const response = await serveStoredObject(store, LATEST_KEY, "br");
    expect(response.headers.get("cache-control")).toBe(headersForKey(LATEST_KEY).cacheControl);
  });

  it("is 404 for a missing object", async () => {
    const response = await serveStoredObject(createMemoryArtifactStore(), VIEW_KEY, "br");
    expect(response.status).toBe(404);
  });
});

describe("route handlers by mode", () => {
  const root = mkdtempSync(path.join(tmpdir(), "repohive-snapshots-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const LOCAL_ENV = {
    REPOHIVE_MODE: "local",
    REPOHIVE_SITE_ORIGIN: "http://localhost:3000",
    REPOHIVE_DATA_DIR: path.join(root, "data"),
    REPOHIVE_STORE: `local:${path.join(root, "store")}`,
    REPOHIVE_LEDGER: `file:${path.join(root, "ledger.json")}`,
    REPOHIVE_ORCHESTRATOR: "local",
  };
  const HOSTED_ENV = {
    REPOHIVE_MODE: "hosted",
    REPOHIVE_SITE_ORIGIN: "https://repohive.example",
    REPOHIVE_DATA_DIR: path.join(root, "data"),
    REPOHIVE_STORE: "s3:bucket",
    REPOHIVE_LEDGER: "dynamodb:table",
    REPOHIVE_ORCHESTRATOR: "sfn:arn:aws:states:ap-south-1:123456789012:stateMachine:x",
    REPOHIVE_GITHUB_TOKEN: "token",
    REPOHIVE_CLIENT_IP_HEADER: "x-client-ip",
    AWS_REGION: "ap-south-1",
  };

  function stubEnv(env: Record<string, string>): void {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  }

  async function get(routeModule: string, url: string, segments: string[]): Promise<Response> {
    const { GET } = (await import(routeModule)) as {
      GET: (request: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;
    };
    return GET(new Request(url, { headers: { "accept-encoding": "br" } }), { params: Promise.resolve({ path: segments }) });
  }

  it("local mode serves both URL shapes from the local store", async () => {
    stubEnv(LOCAL_ENV);
    const store = createLocalArtifactStore(path.join(root, "store"));
    await store.put(VIEW_KEY, await compressBrotli(viewBody), headersForKey(VIEW_KEY));
    await store.put(LATEST_KEY, await compressBrotli(viewBody), headersForKey(LATEST_KEY));
    const view = await get("@/app/s/[...path]/route", `http://localhost:3000/${VIEW_KEY}`, [SNAPSHOT, "views", "graph.json"]);
    expect(view.status).toBe(200);
    expect(view.headers.get("content-encoding")).toBe("br");
    const latest = await get("@/app/r/[...path]/route", `http://localhost:3000/${LATEST_KEY}`, [
      "github.com",
      "local",
      "sample-java-project",
      "latest.json",
    ]);
    expect(latest.status).toBe(200);
    const missing = await get("@/app/s/[...path]/route", "http://localhost:3000/s/x", [SNAPSHOT, "views", "zoom-map.json"]);
    expect(missing.status).toBe(404);
  });

  it("hosted mode returns 404 for both URL shapes", async () => {
    stubEnv(HOSTED_ENV);
    const view = await get("@/app/s/[...path]/route", `https://repohive.example/${VIEW_KEY}`, [SNAPSHOT, "views", "graph.json"]);
    expect(view.status).toBe(404);
    const latest = await get("@/app/r/[...path]/route", `https://repohive.example/${LATEST_KEY}`, [
      "github.com",
      "local",
      "sample-java-project",
      "latest.json",
    ]);
    expect(latest.status).toBe(404);
  });
});
