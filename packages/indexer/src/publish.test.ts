/**
 * Publish and prune (hosting-2 Requirement 9).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { brotliDecompressSync } from "node:zlib";
import type { ArtifactStore, ObjectHeaders } from "./artifact-store.js";
import { createMemoryArtifactStore } from "./artifact-store-memory.js";
import {
  historyKey,
  indexPrefix,
  jsonBytes,
  latestKey,
  manifestKey,
  snapshotPrefix,
  type History,
  type LatestPointer,
  type SnapshotObject,
} from "./layout.js";
import { KEEP_RECENT_SNAPSHOTS, RETIRED_GRACE_MS, publishSnapshot, snapshotsToPrune } from "./publish.js";
import { createLogger } from "./telemetry.js";

const REPO = "github.com/acme/widgets";
const id = (n: number): string => n.toString(16).padStart(32, "0");
const HOUR = 60 * 60 * 1000;

function objectsFor(snapshotId: string): SnapshotObject[] {
  return [
    { key: `${snapshotPrefix(snapshotId)}views/repo.json`, content: jsonBytes({ id: snapshotId }) },
    { key: `${snapshotPrefix(snapshotId)}views/graph.json`, content: jsonBytes({ nodes: [] }) },
    { key: `${indexPrefix(snapshotId)}hierarchy.json`, content: jsonBytes({ formatVersion: 1 }) },
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

function deps(store: ArtifactStore, at: Date, lines: string[] = []) {
  return { store, now: () => at, log: createLogger({ jobId: "j", write: (line) => lines.push(line) }) };
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
  test("uploads every object, then the manifest, then latest.json, in that order", async () => {
    const store = recording(createMemoryArtifactStore());
    const result = await publishSnapshot(input(1), deps(store, new Date("2026-10-01T10:00:00Z")));
    const manifestAt = store.puts.indexOf(manifestKey(id(1)));
    const latestAt = store.puts.indexOf(latestKey(REPO));
    assert.ok(manifestAt > 0 && latestAt > manifestAt);
    assert.deepEqual(
      store.puts.slice(0, manifestAt).sort(),
      objectsFor(id(1)).map((o) => o.key).sort(),
    );
    assert.equal(store.puts.indexOf(historyKey(REPO)) > latestAt, true, "history after latest");
    assert.equal(result.objectCount, 4);
    const latest = await readJson<LatestPointer>(store, latestKey(REPO));
    assert.equal(latest.snapshotId, id(1));
    assert.equal(latest.publishedAt, "2026-10-01T10:00:00.000Z");
  });

  test("stores views, manifest and index brotli-compressed, latest and history as-is", async () => {
    const store = createMemoryArtifactStore();
    await publishSnapshot(input(1), deps(store, new Date(0)));
    const view = (await store.get(`${snapshotPrefix(id(1))}views/repo.json`))!;
    assert.equal(view.headers.contentEncoding, "br");
    assert.equal(brotliDecompressSync(view.body).toString("utf8"), JSON.stringify({ id: id(1) }));
    assert.equal((await store.get(`${indexPrefix(id(1))}hierarchy.json`))!.headers.contentEncoding, "br");
    assert.equal((await store.get(manifestKey(id(1))))!.headers.contentEncoding, "br");
    const latest = (await store.get(latestKey(REPO)))!;
    assert.equal(latest.headers.contentEncoding, undefined);
    assert.equal(latest.headers.cacheControl, "public, max-age=30, stale-while-revalidate=60");
    assert.equal((await store.get(historyKey(REPO)))!.headers.contentEncoding, undefined);
  });

  test("if any upload fails, latest.json is never written", async () => {
    const inner = createMemoryArtifactStore();
    const store = recording(inner, (key) => key.endsWith("views/graph.json"));
    await assert.rejects(publishSnapshot(input(1), deps(store, new Date(0))), /upload failed/);
    assert.equal(await inner.get(latestKey(REPO)), undefined);
    assert.equal(await inner.get(manifestKey(id(1))), undefined);
    assert.equal(await inner.get(historyKey(REPO)), undefined);
  });

  test("a failed manifest upload also leaves latest.json alone, and an existing latest.json untouched", async () => {
    const inner = createMemoryArtifactStore();
    await publishSnapshot(input(1), deps(inner, new Date(0)));
    const before = Buffer.from((await inner.get(latestKey(REPO)))!.body).toString("utf8");
    const store = recording(inner, (key) => key === manifestKey(id(2)));
    await assert.rejects(publishSnapshot(input(2), deps(store, new Date(1000))));
    assert.equal(Buffer.from((await inner.get(latestKey(REPO)))!.body).toString("utf8"), before);
  });

  test("an object outside the snapshot's prefixes is refused", async () => {
    const store = createMemoryArtifactStore();
    await assert.rejects(
      publishSnapshot({ ...input(1), objects: [{ key: "s/other/views/repo.json", content: jsonBytes({}) }] }, deps(store, new Date(0))),
      /outside this snapshot/,
    );
  });

  test("publishing the same snapshot again succeeds and leaves identical objects", async () => {
    const store = createMemoryArtifactStore();
    await publishSnapshot(input(1), deps(store, new Date(0)));
    const keys = (await store.list("s/")).concat(await store.list("idx/"));
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

  test("the snapshot latest.json names is never pruned, even when old", () => {
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
    assert.equal((await store.list("s/")).filter((key) => key.endsWith("repo.json")).length, 5);

    const result = await publishSnapshot(input(6), deps(store, new Date(start + 40 * HOUR)));
    // Retired at 2, 3, 4, 5 hours; at hour 40 snapshots 1, 2 and 3 (ranks 3 to 5, all retired over 24 h) go.
    assert.deepEqual([...result.pruned].sort(), [id(1), id(2), id(3)]);
    for (const gone of [1, 2, 3]) {
      assert.deepEqual(await store.list(snapshotPrefix(id(gone))), []);
      assert.deepEqual(await store.list(indexPrefix(id(gone))), []);
    }
    for (const kept of [4, 5, 6]) {
      assert.ok((await store.list(snapshotPrefix(id(kept)))).length > 0);
    }
    const history = await readJson<History>(store, historyKey(REPO));
    assert.deepEqual(history.snapshots.map((entry) => entry.snapshotId), [id(6), id(5), id(4)]);
    assert.equal((await readJson<LatestPointer>(store, latestKey(REPO))).snapshotId, id(6));
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
    assert.equal((await readJson<LatestPointer>(inner, latestKey(REPO))).snapshotId, id(5));
    // The failed snapshots stay in the history so the next publish retries them.
    const history = await readJson<History>(inner, historyKey(REPO));
    assert.ok(history.snapshots.some((entry) => entry.snapshotId === id(1)));
  });

  test("an unreadable history is logged, never fails the publish", async () => {
    const inner = createMemoryArtifactStore();
    await inner.put(historyKey(REPO), Buffer.from("{not json"), { contentType: "application/json" });
    const lines: string[] = [];
    const result = await publishSnapshot(input(1), deps(inner, new Date(0), lines));
    assert.equal(result.objectCount, 4);
    assert.ok(lines.some((line) => line.includes("history update or prune failed")));
    assert.equal((await readJson<LatestPointer>(inner, latestKey(REPO))).snapshotId, id(1));
  });
});
