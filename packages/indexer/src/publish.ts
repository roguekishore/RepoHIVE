/**
 * Publish and prune (hosting-2 Requirement 9).
 *
 * Order: every object under `s/<id>/` and `idx/<id>/`, then `manifest.json`,
 * then `latest.json`. If any upload fails, `latest.json` is never written, so a
 * reader never sees a half-published snapshot. After the switch, `history.json`
 * is updated and snapshots past retention are deleted; a failure there is
 * logged and does not fail the job, since the new snapshot is already live.
 */
import type { ArtifactStore } from "./artifact-store.js";
import { compareBytewise } from "./canonical-json.js";
import { prepareObject, prepareObjects, type PreparedObject } from "./compression.js";
import {
  buildLatest,
  buildManifest,
  historyKey,
  indexPrefix,
  jsonBytes,
  latestKey,
  manifestKey,
  recordPublish,
  snapshotPrefix,
  type History,
  type SnapshotObject,
} from "./layout.js";
import type { Logger } from "./telemetry.js";

/** Snapshots kept regardless of age (Requirement 9.4). */
export const KEEP_RECENT_SNAPSHOTS = 3;
/** How long a retired snapshot stays before it may be deleted. */
export const RETIRED_GRACE_MS = 24 * 60 * 60 * 1000;
/** Uploads in flight at once. */
const UPLOAD_CONCURRENCY = 16;

export interface PublishInput {
  /** `github.com/<owner>/<repo>`, lowercase. */
  readonly repo: string;
  readonly snapshotId: string;
  readonly commitSha: string;
  readonly engineVersion: string;
  readonly viewsVersion: string;
  readonly indexFormatVersion: number;
  /** Every object of the snapshot except the manifest: views under `s/<id>/` and index files under `idx/<id>/`, uncompressed. */
  readonly objects: readonly SnapshotObject[];
}

export interface PublishDeps {
  readonly store: ArtifactStore;
  readonly now: () => Date;
  readonly log: Logger;
}

export interface PublishResult {
  /** Objects written under `s/` and `idx/`, including the manifest. */
  readonly objectCount: number;
  /** Stored (compressed) bytes of those objects. */
  readonly storedBytes: number;
  /** Snapshot ids deleted by this publish's prune. */
  readonly pruned: readonly string[];
}

async function putAll(store: ArtifactStore, objects: readonly PreparedObject[]): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < objects.length) {
      const object = objects[next++]!;
      await store.put(object.key, object.body, object.headers);
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, objects.length) }, worker));
}

export async function publishSnapshot(input: PublishInput, deps: PublishDeps): Promise<PublishResult> {
  const { store } = deps;
  const prefixes = [snapshotPrefix(input.snapshotId), indexPrefix(input.snapshotId)];
  for (const object of input.objects) {
    if (!prefixes.some((prefix) => object.key.startsWith(prefix))) {
      throw new RangeError(`publish: ${JSON.stringify(object.key)} is outside this snapshot's prefixes`);
    }
  }

  // Compression runs concurrently on the libuv pool; uploads run in a bounded pool of their own.
  const prepared = await prepareObjects([...input.objects].sort((a, b) => compareBytewise(a.key, b.key)));
  const manifest = await prepareObject({
    key: manifestKey(input.snapshotId),
    content: jsonBytes(
      buildManifest(
        {
          repo: input.repo,
          commitSha: input.commitSha,
          engineVersion: input.engineVersion,
          viewsVersion: input.viewsVersion,
          indexFormatVersion: input.indexFormatVersion,
        },
        input.objects,
      ),
    ),
  });

  await putAll(store, prepared);
  await putAll(store, [manifest]);

  const publishedAt = deps.now();
  const latest = buildLatest(
    {
      repo: input.repo,
      snapshotId: input.snapshotId,
      commitSha: input.commitSha,
      engineVersion: input.engineVersion,
      viewsVersion: input.viewsVersion,
    },
    publishedAt,
  );
  const latestObject = await prepareObject({ key: latestKey(input.repo), content: jsonBytes(latest) });
  await store.put(latestObject.key, latestObject.body, latestObject.headers);

  const pruned = await updateHistoryAndPrune(input, publishedAt, deps);

  const all = [...prepared, manifest];
  return { objectCount: all.length, storedBytes: all.reduce((sum, o) => sum + o.body.byteLength, 0), pruned };
}

/**
 * Snapshots to delete from `history`: not among the `KEEP_RECENT_SNAPSHOTS` most
 * recent (the list is newest first), and retired at least 24 hours ago. A
 * snapshot that is still current (`retiredAt` null) is never listed, so the one
 * `latest.json` names is safe.
 */
export function snapshotsToPrune(history: History, now: Date): string[] {
  return history.snapshots
    .slice(KEEP_RECENT_SNAPSHOTS)
    .filter((entry) => entry.retiredAt !== null && now.getTime() - Date.parse(entry.retiredAt) >= RETIRED_GRACE_MS)
    .map((entry) => entry.snapshotId);
}

async function readHistory(store: ArtifactStore, repo: string): Promise<History | undefined> {
  const object = await store.get(historyKey(repo));
  if (object === undefined) {
    return undefined;
  }
  const parsed = JSON.parse(Buffer.from(object.body).toString("utf8")) as History;
  if (!Array.isArray(parsed.snapshots)) {
    throw new Error("history.json is malformed");
  }
  return parsed;
}

async function updateHistoryAndPrune(input: PublishInput, publishedAt: Date, deps: PublishDeps): Promise<string[]> {
  const { store, log } = deps;
  const deleted: string[] = [];
  try {
    let history = recordPublish(await readHistory(store, input.repo), input.snapshotId, publishedAt);
    // The new snapshot is current and first, so it is never a candidate; check anyway.
    const candidates = snapshotsToPrune(history, publishedAt).filter((id) => id !== input.snapshotId);
    for (const id of candidates) {
      try {
        const keys = [...(await store.list(snapshotPrefix(id))), ...(await store.list(indexPrefix(id)))];
        await store.delete(keys);
        deleted.push(id);
      } catch (error) {
        // Kept in the history, so the next publish tries again.
        log.log("warn", "prune of one snapshot failed", { snapshotId: id, error: String(error) });
      }
    }
    if (deleted.length > 0) {
      history = { snapshots: history.snapshots.filter((entry) => !deleted.includes(entry.snapshotId)) };
    }
    const object = await prepareObject({ key: historyKey(input.repo), content: jsonBytes(history) });
    await store.put(object.key, object.body, object.headers);
  } catch (error) {
    log.log("warn", "history update or prune failed; the snapshot is already published", { error: String(error) });
  }
  return deleted;
}
