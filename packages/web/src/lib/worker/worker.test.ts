/**
 * Worker reconciliation and backup retention.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  VIEW_FILES,
  createMemoryArtifactStore,
  createMemoryJobLedger,
  headersForKey,
  jsonBytes,
  viewKey,
  type JobInput,
} from "@repohive/indexer";
import { openAppDatabase, resetAppDatabaseForTests, type AppDatabase } from "@/lib/app-db/database";
import { signUp } from "@/lib/auth/accounts";
import { reserveAcceptedJobCharge } from "@/lib/quota/quota";
import { parseAppConfig, resetAppConfigForTests } from "@/lib/hosting/config";
import { processEndedJobsSinceCheckpoint } from "./process-ended-jobs";
import { maybeBackupAppDatabase } from "./backup";

const LIMITS = parseAppConfig({
  REPOHIVE_MODE: "local",
  REPOHIVE_SITE_ORIGIN: "http://localhost:3000",
  REPOHIVE_DATA_DIR: "data",
  REPOHIVE_STORE: "local:store",
  REPOHIVE_LEDGER: "file:ledger.json",
  REPOHIVE_ORCHESTRATOR: "local",
}).quota;

function sampleInput(accountId: number, overrides: Partial<JobInput> = {}): JobInput {
  return {
    jobId: "job-worker-1",
    accountId: String(accountId),
    repo: "github.com/acme/widgets",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    tier: "S",
    snapshotId: "0123456789abcdef0123456789abcdef",
    visibility: "public",
    ...overrides,
  };
}

function seedAccount(db: AppDatabase): number {
  const created = signUp(db, "127.0.0.1", "worker@example.com", "password-ten-chars");
  if (created.kind !== "created") {
    throw new Error("signup failed");
  }
  return created.accountId;
}

describe("background worker reconciliation", () => {
  let dir: string;
  let dbPath: string;
  let db: AppDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "repohive-worker-"));
    dbPath = join(dir, "app.sqlite");
    resetAppConfigForTests();
    db = openAppDatabase(dbPath);
    resetAppDatabaseForTests(db);
  });

  afterEach(() => {
    db.close();
    resetAppDatabaseForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("records a succeeded job, clears in-flight and advances the checkpoint", async () => {
    const accountId = seedAccount(db);
    reserveAcceptedJobCharge(db, { accountId, ip: "127.0.0.1", jobId: "job-worker-1", limits: LIMITS });
    const ledger = createMemoryJobLedger();
    const store = createMemoryArtifactStore();
    await ledger.claim(sampleInput(accountId));
    await ledger.finish("job-worker-1", { state: "succeeded" });
    await store.put(
      viewKey("0123456789abcdef0123456789abcdef", VIEW_FILES.hierarchyScale),
      jsonBytes({ totalNodes: 42 }),
      headersForKey(viewKey("0123456789abcdef0123456789abcdef", VIEW_FILES.hierarchyScale)),
    );

    const first = await processEndedJobsSinceCheckpoint(db, ledger, store);
    expect(first.processed).toBe(1);
    const row = db
      .prepare("SELECT repo, node_count FROM indexed_repositories WHERE repo = ?")
      .get("github.com/acme/widgets") as { repo: string; node_count: number };
    expect(row.node_count).toBe(42);
    expect(db.prepare("SELECT 1 FROM account_inflight WHERE account_id = ?").get(accountId)).toBeUndefined();

    const second = await processEndedJobsSinceCheckpoint(db, ledger, store);
    expect(second.processed).toBe(0);
  });

  it("refunds a system failure once and clears in-flight", async () => {
    const accountId = seedAccount(db);
    reserveAcceptedJobCharge(db, { accountId, ip: "127.0.0.1", jobId: "job-worker-1", limits: LIMITS });
    const ledger = createMemoryJobLedger();
    const store = createMemoryArtifactStore();
    await ledger.claim(sampleInput(accountId));
    await ledger.finish("job-worker-1", { state: "failed", failureClass: "system", failureCode: "timeout" });

    await processEndedJobsSinceCheckpoint(db, ledger, store);
    const charge = db.prepare("SELECT refunded FROM index_charges WHERE job_id = ?").get("job-worker-1") as {
      refunded: number;
    };
    expect(charge.refunded).toBe(1);
    expect(db.prepare("SELECT 1 FROM account_inflight WHERE account_id = ?").get(accountId)).toBeUndefined();
  });

  it("uploads at most one sqlite backup per utc day", async () => {
    const store = createMemoryArtifactStore();
    const first = await maybeBackupAppDatabase(db, dbPath, store);
    const second = await maybeBackupAppDatabase(db, dbPath, store);
    expect(first).toBe(true);
    expect(second).toBe(false);
    const keys = await store.list("backup/");
    expect(keys.length).toBe(1);
  });
});
