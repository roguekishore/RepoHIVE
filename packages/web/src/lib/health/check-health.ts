/**
 * hosting-3 Requirement 12: health checks with per-check timeouts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppDatabase } from "@/lib/app-db/database";
import type { AppConfig } from "@/lib/hosting/config";
import { getJobLedger } from "@/lib/hosting/clients";

interface HealthReport {
  readonly status: "ok" | "degraded";
  readonly version: string;
  readonly ledgerReachable: boolean;
  readonly lastCompletedJobAt: string | null;
}

const CHECK_TIMEOUT_MS = 800;

function readWebVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), CHECK_TIMEOUT_MS);
    }),
  ]);
}

async function checkLedgerReachable(config: AppConfig): Promise<boolean> {
  try {
    const ledger = getJobLedger(config);
    // A read that does not answer within the timeout counts as unreachable, not as reachable.
    return await withTimeout(
      ledger.get("__health_probe__").then(() => true),
      false,
    );
  } catch {
    return false;
  }
}

function checkSqliteReachable(db: AppDatabase): boolean {
  try {
    db.prepare("SELECT 1 AS ok").get();
    return true;
  } catch {
    return false;
  }
}

function readLastCompletedJobAt(db: AppDatabase): string | null {
  const row = db.prepare("SELECT MAX(indexed_at) AS last_at FROM indexed_repositories").get() as
    | { last_at: string | null }
    | undefined;
  const value = row?.last_at;
  return value === null || value === undefined || value === "" ? null : value;
}

export async function checkHealth(db: AppDatabase, config: AppConfig): Promise<HealthReport> {
  const [ledgerReachable, sqliteReachable] = await Promise.all([
    checkLedgerReachable(config),
    Promise.resolve(checkSqliteReachable(db)),
  ]);
  const status = ledgerReachable && sqliteReachable ? "ok" : "degraded";
  return {
    status,
    version: readWebVersion(),
    ledgerReachable,
    lastCompletedJobAt: readLastCompletedJobAt(db),
  };
}
