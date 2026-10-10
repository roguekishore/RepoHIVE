/**
 * Publish and prune.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { brotliDecompressSync } from "node:zlib";
import type { ArtifactStore, ObjectHeaders } from "./artifact-store.js";
import { createMemoryArtifactStore } from "./artifact-store-memory.js";
import {
  historyKey,
  indexPrefix,
  privateSnapshotPrefix,
  jsonBytes,
  manifestKey,
  snapshotPrefix,
  type History,
  type SnapshotObject,
} from "./layout.js";
import { KEEP_RECENT_SNAPSHOTS, RETIRED_GRACE_MS, publishSnapshot, snapshotsToPrune } from "./publish.js";
import { createLogger } from "./telemetry.js";

const REPO = "github.com/acme/widgets";
const id = (n: number): string => n.toString(16).padStart(32, "0");
const HOUR = 60 * 60 * 1000;

function objectsFor(snapshotId: string): SnapshotObject[] {
  return [
    { key: `${snapshotPrefix(REPO, snapshotId)}views/repo.json`, content: jsonBytes({ id: snapshotId }) },
    { key: `${snapshotPrefix(REPO, snapshotId)}views/graph.json`, content: jsonBytes({ nodes: [] }) },
    { key: `${indexPrefix(REPO, snapshotId)}hierarchy.json`, content: jsonBytes({ formatVersion: 1 }) },
  ];
}

function input(n: number) {
  return {
    repo: REPO,
    snapshotId: id(n),
    commitSha: "a".repeat(40),
    engineVersion: "engine",
    viewsVersion: "views",
    indexFormatVersion: 1,
    objects: objectsFor(id(n)),
  };
}

function deps(store: ArtifactStore, at: Date, lines: string[] = [], activeSnapshotId?: () => Promise<string | undefined>) {
  return {
    store,
    now: () => at,
    log: createLogger({ jobId: "j", write: (line) => lines.push(line) }),
    ...(activeSnapshotId === undefined ? {} : { activeSnapshotId }),
  };
}

const readJson = async <T>(store: ArtifactStore, key: string): Promise<T> =>
  JSON.parse(Buffer.from((await store.get(key))!.body).toString("utf8")) as T;

/** A store that records every put, and can fail chosen keys. */
function recording(inner: ArtifactStore, failOn: (key: string) => boolean = () => false): ArtifactStore & { puts: string[] } {
  const puts: string[] = [];
  return {
    puts,
    get: (key) => inner.get(key),
    list: (prefix) => inner.list(prefix),
    delete: (keys) => inner.delete(keys),
    async put(key: string, body: Uint8Array, headers: ObjectHeaders) {
      if (failOn(key)) throw new Error(`upload failed: ${key}`);
      puts.push(key);
      await inner.put(key, body, headers);
    },
  };
}

describe("publish", () => {
  test("uploads every object (sorted), then the manifest, and writes no latest pointer", async () => {
    const store = recording(createMemoryArtifactStore());
    const result = await publishSnapshot(input(1), deps(store, new Date("2026-10-01T10:00:00Z")));
    const manifestAt = store.puts.indexOf(manifestKey(REPO, id(1)));
    assert.ok(manifestAt > 0);
    const expected = objectsFor(id(1)).map((o) => o.key).sort();
    assert.deepEqual(store.puts.slice(0, manifestAt), expected);
    assert.ok(store.puts.indexOf(historyKey(REPO)) > manifestAt, "history after the manifest");
    assert.deepEqual(
      store.puts.filter((key) => key.includes("latest")),
      [],
    );
    assert.equal(result.objectCount, 4);
  });

  test("keys are under artifacts/ and private/", async () => {
    const store = recording(createMemoryArtifactStore());
    await publishSnapshot(input(1), deps(store, new Date(0)));
    assert.deepEqual(store.puts.sort(), [
      `artifacts/acme/widgets/${id(1)}/manifest.json`,
      `artifacts/acme/widgets/${id(1)}/views/graph.json`,
      `artifacts/acme/widgets/${id(1)}/views/repo.json`,
      `private/acme/widgets/${id(1)}/index/hierarchy.json`,
      "private/acme/widgets/history.json",
    ]);
  });

  test("stores views, manifest and index brotli-compressed, history as-is", async () => {
    const store = createMemoryArtifactStore();
    await publishSnapshot(input(1), deps(store, new Date(0)));
    const view = (await store.get(`${snapshotPrefix(REPO, id(1))}views/repo.json`))!;
    assert.equal(view.headers.contentEncoding, "br");
    assert.equal(brotliDecompressSync(view.body).toString("utf8"), JSON.stringify({ id: id(1) }));
    assert.equal((await store.get(`${indexPrefix(REPO, id(1))}hierarchy.json`))!.headers.contentEncoding, "br");
    assert.equal((await store.get(manifestKey(REPO, id(1))))!.headers.contentEncoding, "br");
    const history = (await store.get(historyKey(REPO)))!;
    assert.equal(history.headers.contentEncoding, undefined);
    assert.equal(history.headers.cacheControl, undefined);
  });

  test("if any upload fails, the manifest and history are never written", async () => {
    const inner = createMemoryArtifactStore();
    const store = recording(inner, (key) => key.endsWith("views/graph.json"));
    await assert.rejects(publishSnapshot(input(1), deps(store, new Date(0))), /upload failed/);
    assert.equal(await inner.get(manifestKey(REPO, id(1))), undefined);
    assert.equal(await inner.get(historyKey(REPO)), undefined);
  });

  test("a failed manifest upload leaves the history untouched", async () => {
    const inner = createMemoryArtifactStore();
    await publishSnapshot(input(1), deps(inner, new Date(0)));
    const before = Buffer.from((await inner.get(historyKey(REPO)))!.body).toString("utf8");
    const store = recording(inner, (key) => key === manifestKey(REPO, id(2)));
    await assert.rejects(publishSnapshot(input(2), deps(store, new Date(1000))));
    assert.equal(Buffer.from((await inner.get(historyKey(REPO)))!.body).toString("utf8"), before);
  });

  test("an object outside the snapshot's prefixes is refused", async () => {
    const store = createMemoryArtifactStore();
    await assert.rejects(
      publishSnapshot({ ...input(1), objects: [{ key: `artifacts/acme/widgets/${id(2)}/views/repo.json`, content: jsonBytes({}) }] }, deps(store, new Date(0))),
      /outside this snapshot/,
    );
    await assert.rejects(
      publishSnapshot({ ...input(1), objects: [{ key: `idx/${id(1)}/hierarchy.json`, content: jsonBytes({}) }] }, deps(store, new Date(0))),
      /outside this snapshot/,
    );
  });

  test("publishing the same snapshot again succeeds and leaves identical objects", async () => {
    const store = createMemoryArtifactStore();
    await publishSnapshot(input(1), deps(store, new Date(0)));
    const keys = (await store.list("artifacts/")).concat(await store.list("private/")).filter((key) => !key.endsWith("history.json"));
    const before = new Map(await Promise.all(keys.map(async (key) => [key, Buffer.from((await store.get(key))!.body)] as const)));
    await publishSnapshot(input(1), deps(store, new Date(HOUR)));
    for (const [key, body] of before) {
      assert.deepEqual(Buffer.from((await store.get(key))!.body), body, key);
    }
    const history = await readJson<History>(store, historyKey(REPO));
    assert.equal(history.snapshots.length, 1);
  });
});

describe("history and prune", () => {
  test("a new snapshot retires the previous one in the history, newest first", async () => {
    const store = createMemoryArtifactStore();
    await publishSnapshot(input(1), deps(store, new Date("2026-10-01T00:00:00Z")));
    await publishSnapshot(input(2), deps(store, new Date("2026-10-01T01:00:00Z")));
    const history = await readJson<History>(store, historyKey(REPO));
    assert.deepEqual(history.snapshots, [
      { snapshotId: id(2), publishedAt: "2026-10-01T01:00:00.000Z", retiredAt: null },
      { snapshotId: id(1), publishedAt: "2026-10-01T00:00:00.000Z", retiredAt: "2026-10-01T01:00:00.000Z" },
    ]);
  });

  test("snapshotsToPrune keeps the 3 most recent and anything retired under 24 hours", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const at = (hoursAgo: number): string => new Date(now.getTime() - hoursAgo * HOUR).toISOString();
    const history: History = {
      snapshots: [
        { snapshotId: id(6), publishedAt: at(1), retiredAt: null },
        { snapshotId: id(5), publishedAt: at(50), retiredAt: at(1) },
        { snapshotId: id(4), publishedAt: at(60), retiredAt: at(50) },
        { snapshotId: id(3), publishedAt: at(70), retiredAt: at(23) },
        { snapshotId: id(2), publishedAt: at(80), retiredAt: at(24) },
        { snapshotId: id(1), publishedAt: at(90), retiredAt: at(80) },
      ],
    };
    assert.equal(KEEP_RECENT_SNAPSHOTS, 3);
    assert.equal(RETIRED_GRACE_MS, 24 * HOUR);
    // id(3) is 4th but retired 23 h ago: kept. id(2) retired exactly 24 h ago, id(1) long ago: pruned.
    assert.deepEqual(snapshotsToPrune(history, now), [id(2), id(1)]);
  });

  test("the current snapshot is never pruned, even when old", () => {
    const history: History = {
      snapshots: [
        { snapshotId: id(9), publishedAt: "2020-01-01T00:00:00.000Z", retiredAt: null },
        ...[1, 2, 3, 4].map((n) => ({ snapshotId: id(n), publishedAt: "2019-01-01T00:00:00.000Z", retiredAt: "2019-01-02T00:00:00.000Z" })),
      ],
    };
    const pruned = snapshotsToPrune(history, new Date("2026-01-01T00:00:00Z"));
    assert.ok(!pruned.includes(id(9)));
    assert.deepEqual(pruned, [id(3), id(4)]);
    // Even if the current entry sat past the keep window, `retiredAt: null` protects it.
    const odd: History = {
      snapshots: [1, 2, 3].map((n) => ({ snapshotId: id(n), publishedAt: "2019-01-01T00:00:00.000Z", retiredAt: "2019-01-02T00:00:00.000Z" })).concat([
        { snapshotId: id(9), publishedAt: "2019-01-01T00:00:00.000Z", retiredAt: null as never },
      ]),
    };
    assert.ok(!snapshotsToPrune(odd, new Date("2026-01-01T00:00:00Z")).includes(id(9)));
  });

  test("publishing deletes the objects of pruned snapshots and drops them from the history", async () => {
    const store = createMemoryArtifactStore();
    const start = Date.parse("2026-10-01T00:00:00Z");
    for (let n = 1; n <= 5; n += 1) {
      await publishSnapshot(input(n), deps(store, new Date(start + n * HOUR)));
    }
    // After five publishes an hour apart nothing has been retired for 24 hours yet.
    assert.equal((await store.list("artifacts/")).filter((key) => key.endsWith("repo.json")).length, 5);

    const result = await publishSnapshot(input(6), deps(store, new Date(start + 40 * HOUR)));
    // Retired at 2, 3, 4, 5 hours; at hour 40 snapshots 1, 2 and 3 (ranks 3 to 5, all retired over 24 h) go.
    assert.deepEqual([...result.pruned].sort(), [id(1), id(2), id(3)]);
    for (const gone of [1, 2, 3]) {
      assert.deepEqual(await store.list(snapshotPrefix(REPO, id(gone))), []);
      assert.deepEqual(await store.list(privateSnapshotPrefix(REPO, id(gone))), []);
    }
    for (const kept of [4, 5, 6]) {
      assert.ok((await store.list(snapshotPrefix(REPO, id(kept)))).length > 0);
    }
    const history = await readJson<History>(store, historyKey(REPO));
    assert.deepEqual(history.snapshots.map((entry) => entry.snapshotId), [id(6), id(5), id(4)]);
  });

  test("a prune failure is logged and does not fail the publish", async () => {
    const inner = createMemoryArtifactStore();
    const start = Date.parse("2026-10-01T00:00:00Z");
    for (let n = 1; n <= 4; n += 1) {
      await publishSnapshot(input(n), deps(inner, new Date(start + n * HOUR)));
    }
    const lines: string[] = [];
    const store: ArtifactStore = {
      put: (key, body, headers) => inner.put(key, body, headers),
      get: (key) => inner.get(key),
      list: (prefix) => inner.list(prefix),
      delete: async () => {
        throw new Error("delete denied");
      },
    };
    const result = await publishSnapshot(input(5), deps(store, new Date(start + 100 * HOUR), lines));
    assert.deepEqual(result.pruned, []);
    assert.ok(lines.some((line) => line.includes("prune of one snapshot failed")));
    // The failed snapshots stay in the history so the next publish retries them.
    const history = await readJson<History>(inner, historyKey(REPO));
    assert.ok(history.snapshots.some((entry) => entry.snapshotId === id(1)));
  });

  async function fivePublished(start: number): Promise<ArtifactStore> {
    const store = createMemoryArtifactStore();
    for (let n = 1; n <= 5; n += 1) {
      await publishSnapshot(input(n), deps(store, new Date(start + n * HOUR)));
    }
    return store;
  }

  test("pruning deletes both the public and the private prefix of a snapshot", async () => {
    const start = Date.parse("2026-10-01T00:00:00Z");
    const store = await fivePublished(start);
    await publishSnapshot(input(6), deps(store, new Date(start + 40 * HOUR)));
    assert.deepEqual(await store.list(`artifacts/acme/widgets/${id(1)}/`), []);
    assert.deepEqual(await store.list(`private/acme/widgets/${id(1)}/`), []);
    assert.ok((await store.list(`private/acme/widgets/${id(4)}/`)).length > 0);
  });

  test("the snapshot the server reports active is never pruned, and stays in the history", async () => {
    const start = Date.parse("2026-10-01T00:00:00Z");
    const store = await fivePublished(start);
    const result = await publishSnapshot(input(6), deps(store, new Date(start + 40 * HOUR), [], async () => id(2)));
    assert.deepEqual([...result.pruned].sort(), [id(1), id(3)]);
    assert.ok((await store.list(snapshotPrefix(REPO, id(2)))).length > 0);
    assert.ok((await store.list(privateSnapshotPrefix(REPO, id(2)))).length > 0);
    const history = await readJson<History>(store, historyKey(REPO));
    assert.deepEqual(history.snapshots.map((entry) => entry.snapshotId), [id(6), id(5), id(4), id(2)]);
  });

  test("an active snapshot of undefined excludes nothing", async () => {
    const start = Date.parse("2026-10-01T00:00:00Z");
    const store = await fivePublished(start);
    const result = await publishSnapshot(input(6), deps(store, new Date(start + 40 * HOUR), [], async () => undefined));
    assert.deepEqual([...result.pruned].sort(), [id(1), id(2), id(3)]);
  });

  test("if the active snapshot cannot be read, nothing is deleted but history is still written", async () => {
    const start = Date.parse("2026-10-01T00:00:00Z");
    const store = await fivePublished(start);
    const lines: string[] = [];
    const result = await publishSnapshot(
      input(6),
      deps(store, new Date(start + 40 * HOUR), lines, async () => {
        throw new Error("server down");
      }),
    );
    assert.deepEqual(result.pruned, []);
    assert.ok(lines.some((line) => line.includes("could not read the active snapshot")));
    assert.ok((await store.list(snapshotPrefix(REPO, id(1)))).length > 0);
    const history = await readJson<History>(store, historyKey(REPO));
    assert.equal(history.snapshots[0]?.snapshotId, id(6));
    assert.equal(history.snapshots.length, 6);
  });

  test("the just-published snapshot is never deleted even if the active read names another", async () => {
    const store = createMemoryArtifactStore();
    const result = await publishSnapshot(input(1), deps(store, new Date(0), [], async () => id(9)));
    assert.deepEqual(result.pruned, []);
    assert.ok((await store.list(snapshotPrefix(REPO, id(1)))).length > 0);
  });

  test("an unreadable history is logged, never fails the publish", async () => {
    const inner = createMemoryArtifactStore();
    await inner.put(historyKey(REPO), Buffer.from("{not json"), { contentType: "application/json" });
    const lines: string[] = [];
    const result = await publishSnapshot(input(1), deps(inner, new Date(0), lines));
    assert.equal(result.objectCount, 4);
    assert.ok(lines.some((line) => line.includes("history update or prune failed")));
  });
});
