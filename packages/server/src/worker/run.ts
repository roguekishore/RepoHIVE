import type { ArtifactStore, JobLedger } from "@repohive/indexer";
import type { AppDatabase } from "../app-db/database";
import type { AppConfig } from "../hosting/config";
import { runWorkerTick } from "./tick";

const INTERVAL_MS = 10_000;

/** Runs a worker tick now and then every 10 seconds. Returns a function that stops the loop. */
export function startWorker(config: AppConfig, db: AppDatabase, ledger: JobLedger, store: ArtifactStore): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runWorkerTick(config, db, ledger, store);
      if (result.processed > 0 || result.backupTaken) {
        console.log(JSON.stringify({ level: "info", msg: "worker tick", ...result }));
      }
    } catch (error) {
      console.error(JSON.stringify({ level: "error", msg: "worker tick failed", error: String(error) }));
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  return () => clearInterval(timer);
}
