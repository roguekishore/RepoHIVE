/**
 * hosting-3 Requirement 10: reconcile finished ledger jobs with SQLite.
 */
import { brotliDecompressSync } from "node:zlib";
import {
  VIEW_FILES,
  isTerminalJobState,
  manifestKey,
  viewKey,
  type ArtifactStore,
  type JobLedger,
  type JobRecord,
} from "@repohive/indexer";
import type { AppDatabase } from "@/server/app-db/database";
import { clearAccountInflight, refundJobCharge } from "@/server/quota/quota";
import { readWorkerCheckpoint, writeWorkerCheckpoint } from "./checkpoint";
import { markJobOutcomeProcessed, upsertIndexedRepository } from "./repositories";

interface HierarchyScaleView {
  readonly totalNodes?: number;
}

async function readNodeCount(store: ArtifactStore, snapshotId: string): Promise<number> {
  const key = viewKey(snapshotId, VIEW_FILES.hierarchyScale);
  const object = await store.get(key);
  if (object === undefined) {
    return 0;
  }
  const bytes = object.headers.contentEncoding === "br" ? brotliDecompressSync(object.body) : object.body;
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as HierarchyScaleView;
  return typeof parsed.totalNodes === "number" && parsed.totalNodes >= 0 ? parsed.totalNodes : 0;
}

async function recordSucceededJob(
  db: AppDatabase,
  store: ArtifactStore,
  record: JobRecord,
): Promise<void> {
  const manifestObject = await store.get(manifestKey(record.input.snapshotId));
  const indexedAt =
    record.endedAt ??
    (manifestObject === undefined ? new Date().toISOString() : new Date().toISOString());
  const nodeCount = await readNodeCount(store, record.input.snapshotId);
  upsertIndexedRepository(db, {
    repo: record.input.repo,
    snapshotId: record.input.snapshotId,
    commitSha: record.input.commitSha,
    indexedAt,
    nodeCount,
    jobId: record.input.jobId,
  });
}

function parseAccountId(accountId: string): number | undefined {
  const parsed = Number.parseInt(accountId, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function processEndedJobsSinceCheckpoint(
  db: AppDatabase,
  ledger: JobLedger,
  store: ArtifactStore,
): Promise<{ processed: number; checkpoint: string }> {
  let checkpoint = readWorkerCheckpoint(db);
  const ended = await ledger.listJobsEndedSince(checkpoint);
  let processed = 0;
  let latestEnded = checkpoint;

  for (const record of ended) {
    if (!isTerminalJobState(record.state) || record.endedAt === undefined) {
      continue;
    }
    if (!markJobOutcomeProcessed(db, record.input.jobId)) {
      if (record.endedAt > latestEnded) {
        latestEnded = record.endedAt;
      }
      continue;
    }

    const accountId = parseAccountId(record.input.accountId);
    if (accountId !== undefined) {
      if (record.state === "failed" && record.failureClass === "system") {
        refundJobCharge(db, record.input.jobId, accountId);
      } else {
        clearAccountInflight(db, accountId, record.input.jobId);
      }
    }

    if (record.state === "succeeded") {
      await recordSucceededJob(db, store, record);
    }

    processed += 1;
    if (record.endedAt > latestEnded) {
      latestEnded = record.endedAt;
    }
  }

  if (latestEnded !== checkpoint) {
    writeWorkerCheckpoint(db, latestEnded);
    checkpoint = latestEnded;
  }

  return { processed, checkpoint };
}
