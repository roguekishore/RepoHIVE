import { join } from "node:path";
import type { ArtifactStore, JobLedger } from "@repohive/indexer";
import type { AppDatabase } from "@/lib/app-db/database";
import { APP_DB_FILENAME } from "@/lib/app-db/schema";
import type { AppConfig } from "@/lib/hosting/config";
import { maybeBackupAppDatabase } from "./backup";
import { processEndedJobsSinceCheckpoint } from "./process-ended-jobs";

export interface WorkerTickResult {
  readonly processed: number;
  readonly checkpoint: string;
  readonly backupTaken: boolean;
}

export async function runWorkerTick(
  config: AppConfig,
  db: AppDatabase,
  ledger: JobLedger,
  store: ArtifactStore,
): Promise<WorkerTickResult> {
  const reconcile = await processEndedJobsSinceCheckpoint(db, ledger, store);
  const dbPath = join(config.dataDirectory, APP_DB_FILENAME);
  const backupTaken = await maybeBackupAppDatabase(db, dbPath, store);
  return { ...reconcile, backupTaken };
}
