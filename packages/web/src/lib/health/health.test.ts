/**
 * Health endpoint shape and degradation.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryArtifactStore, createMemoryJobLedger } from "@repohive/indexer";
import { openAppDatabase, resetAppDatabaseForTests } from "@/lib/app-db/database";
import { resetAppConfigForTests } from "@/lib/hosting/config";
import { resetHostingClientsForTests } from "@/lib/hosting/clients";
import { upsertIndexedRepository } from "@/lib/worker/repositories";
import { GET as healthGet } from "@/app/healthz/route";

describe("GET /healthz", () => {
  let scratch: string;
  let dbPath: string;
  let db: ReturnType<typeof openAppDatabase>;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "repohive-health-"));
    dbPath = join(scratch, "app.sqlite");
    resetAppConfigForTests();
    Object.assign(process.env, {
      REPOHIVE_MODE: "local",
      REPOHIVE_SITE_ORIGIN: "http://localhost:3000",
      REPOHIVE_DATA_DIR: join(scratch, "data"),
      REPOHIVE_STORE: `local:${join(scratch, "store")}`,
      REPOHIVE_LEDGER: `file:${join(scratch, "ledger.json")}`,
      REPOHIVE_ORCHESTRATOR: "local",
    });
    db = openAppDatabase(dbPath);
    resetAppDatabaseForTests(db);
    resetHostingClientsForTests(createMemoryArtifactStore(), createMemoryJobLedger());
  });

  afterEach(() => {
    db.close();
    resetAppDatabaseForTests();
    resetHostingClientsForTests();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("returns ok with version and lastCompletedJobAt without repository names", async () => {
    upsertIndexedRepository(db, {
      repo: "github.com/acme/widgets",
      snapshotId: "a".repeat(32),
      commitSha: "b".repeat(40),
      indexedAt: "2026-05-01T12:00:00.000Z",
      nodeCount: 3,
      jobId: "job-1",
    });
    resetAppDatabaseForTests(db);
    resetHostingClientsForTests(undefined, createMemoryJobLedger());

    const response = await healthGet();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(body.ledgerReachable).toBe(true);
    expect(body.lastCompletedJobAt).toBe("2026-05-01T12:00:00.000Z");
    expect(JSON.stringify(body).includes("acme")).toBe(false);
  });

  it("reports degraded when the ledger read does not answer in time", async () => {
    const hanging = { ...createMemoryJobLedger(), get: () => new Promise<never>(() => {}) };
    resetHostingClientsForTests(undefined, hanging);

    const response = await healthGet();
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("degraded");
    expect(body.ledgerReachable).toBe(false);
  });
});
