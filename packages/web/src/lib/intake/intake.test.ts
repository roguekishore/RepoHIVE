/**
 * Intake flow, job status and orchestrator hooks.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { engineVersion } from "@repohive/engine";
import {
  buildLatest,
  createMemoryArtifactStore,
  createMemoryJobLedger,
  headersForKey,
  hostedConfigDigest,
  jsonBytes,
  latestKey,
  precheck,
  type FetchFunction,
  type JobInput,
} from "@repohive/indexer";
import { getViewsVersion } from "@repohive/views";
import { openAppDatabase, resetAppDatabaseForTests } from "@/lib/app-db/database";
import { resetAppConfigForTests, parseAppConfig } from "@/lib/hosting/config";
import { createRepoLockReader } from "@/lib/hosting/repo-lock";
import { StartExecutionCommand } from "@aws-sdk/client-sfn";
import { createSfnJobOrchestrator } from "@/lib/orchestrator/sfn";
import { processIndexRequest } from "./process-index-request";
import { POST as indexPost } from "@/app/api/index/route";
import { GET as jobGet } from "@/app/api/jobs/[jobId]/route";
import { signUp } from "@/lib/auth/accounts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const LOCAL_ENV = {
  REPOHIVE_MODE: "local",
  REPOHIVE_SITE_ORIGIN: "http://localhost:3000",
  REPOHIVE_DATA_DIR: "data",
  REPOHIVE_STORE: "local:store",
  REPOHIVE_LEDGER: "file:ledger.json",
  REPOHIVE_ORCHESTRATOR: "local",
};

function mockFetch(): FetchFunction {
  return async (url) => {
    if (url.includes("/git/trees/")) {
      return new Response(
        JSON.stringify({
          tree: [
            { path: "src/A.java", type: "blob", size: 10 },
            { path: "src/B.java", type: "blob", size: 10 },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/commits/")) {
      return new Response(JSON.stringify({ sha: SHA }), { status: 200 });
    }
    return new Response(JSON.stringify({ private: false, archived: false, default_branch: "main" }), { status: 200 });
  };
}

function seedAccount(db: ReturnType<typeof openAppDatabase>): number {
  const created = signUp(db, "1.2.3.4", "user@example.com", "password-ten-chars");
  if (created.kind !== "created") {
    throw new Error("signup failed");
  }
  return created.accountId;
}

describe("processIndexRequest", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "repohive-intake-"));
    Object.assign(process.env, {
      ...LOCAL_ENV,
      REPOHIVE_DATA_DIR: join(scratch, "data"),
      REPOHIVE_LEDGER: `file:${join(scratch, "ledger.json")}`,
    });
    resetAppConfigForTests();
    resetAppDatabaseForTests(openAppDatabase(":memory:"));
  });

  afterEach(() => {
    resetAppDatabaseForTests();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("returns cached without charging when latest.json matches", async () => {
    const db = openAppDatabase(":memory:");
    resetAppDatabaseForTests(db);
    const accountId = seedAccount(db);
    const store = createMemoryArtifactStore();
    const precheckDeps = {
      token: "server-token",
      store,
      viewsVersion: getViewsVersion(),
      engineVersion,
      configDigest: hostedConfigDigest(),
      fetch: mockFetch(),
    };
    const checked = await precheck("acme/widgets", precheckDeps);
    if (!checked.ok) {
      throw new Error("precheck failed");
    }
    const { repo, snapshotId, commitSha } = checked;
    await store.put(
      latestKey(repo),
      jsonBytes(
        buildLatest(
          {
            repo,
            snapshotId,
            commitSha,
            engineVersion,
            viewsVersion: getViewsVersion(),
          },
          new Date("2026-01-01T00:00:00.000Z"),
        ),
      ),
      headersForKey(latestKey(repo)),
    );
    const ledger = createMemoryJobLedger();
    const config = parseAppConfig(process.env, scratch);
    const outcome = await processIndexRequest(
      { accountId, ip: "5.6.7.8", repoText: "acme/widgets" },
      {
        db,
        config,
        store,
        ledger,
        orchestrator: { start: async () => {} },
        repoLocks: createRepoLockReader(config),
        precheckFetch: mockFetch(),
      },
    );
    expect(outcome).toMatchObject({ kind: "cached", repo, snapshotId });
    expect(db.prepare("SELECT COUNT(*) AS c FROM index_charges").get()).toEqual({ c: 0 });
  });

  it("returns joined when the repository lock exists", async () => {
    const db = openAppDatabase(":memory:");
    resetAppDatabaseForTests(db);
    const accountId = seedAccount(db);
    const store = createMemoryArtifactStore();
    const ledger = createMemoryJobLedger();
    const config = parseAppConfig(process.env, scratch);
    const existing: JobInput = {
      jobId: "existing-job",
      accountId: "1",
      repo: "github.com/acme/widgets",
      commitSha: SHA,
      tier: "S",
      snapshotId: "0123456789abcdef0123456789abcdef",
      visibility: "public",
    };
    await ledger.claim(existing);
    const outcome = await processIndexRequest(
      { accountId, ip: "5.6.7.8", repoText: "acme/widgets" },
      {
        db,
        config,
        store,
        ledger,
        orchestrator: { start: async () => {} },
        repoLocks: {
          findInFlightJobId: async (repo) => (repo === existing.repo ? existing.jobId : undefined),
        },
        precheckFetch: mockFetch(),
      },
    );
    expect(outcome).toEqual({ kind: "joined", jobId: "existing-job", httpStatus: 200 });
  });

  it("returns busy and releases the charge when the global cap is reached", async () => {
    const db = openAppDatabase(":memory:");
    resetAppDatabaseForTests(db);
    const accountId = seedAccount(db);
    const store = createMemoryArtifactStore();
    const ledger = createMemoryJobLedger({ inflightCap: 0 });
    const config = parseAppConfig(process.env, scratch);
    const start = vi.fn(async () => {});
    const outcome = await processIndexRequest(
      { accountId, ip: "5.6.7.8", repoText: "acme/widgets" },
      {
        db,
        config,
        store,
        ledger,
        orchestrator: { start },
        repoLocks: createRepoLockReader(config),
        precheckFetch: mockFetch(),
      },
    );
    expect(outcome.kind).toBe("busy");
    expect(start).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS c FROM index_charges").get()).toEqual({ c: 0 });
  });

  it("accepts, starts the orchestrator and exposes the job", async () => {
    const db = openAppDatabase(":memory:");
    resetAppDatabaseForTests(db);
    const accountId = seedAccount(db);
    const store = createMemoryArtifactStore();
    const ledger = createMemoryJobLedger();
    const config = parseAppConfig(process.env, scratch);
    const started: JobInput[] = [];
    const outcome = await processIndexRequest(
      { accountId, ip: "5.6.7.8", repoText: "acme/widgets" },
      {
        db,
        config,
        store,
        ledger,
        orchestrator: { start: async (input) => { started.push(input); } },
        repoLocks: createRepoLockReader(config),
        precheckFetch: mockFetch(),
      },
    );
    expect(outcome.kind).toBe("accepted");
    if (outcome.kind === "accepted") {
      const record = await ledger.get(outcome.jobId);
      expect(record?.state).toBe("queued");
      expect(started).toHaveLength(1);
    }
  });

  it("refunds when the orchestrator fails to start", async () => {
    const db = openAppDatabase(":memory:");
    resetAppDatabaseForTests(db);
    const accountId = seedAccount(db);
    const store = createMemoryArtifactStore();
    const ledger = createMemoryJobLedger();
    const config = parseAppConfig(process.env, scratch);
    const outcome = await processIndexRequest(
      { accountId, ip: "5.6.7.8", repoText: "acme/widgets" },
      {
        db,
        config,
        store,
        ledger,
        orchestrator: { start: async () => { throw new Error("spawn failed"); } },
        repoLocks: createRepoLockReader(config),
        precheckFetch: mockFetch(),
      },
    );
    expect(outcome.kind).toBe("rejected");
    expect(db.prepare("SELECT refunded FROM index_charges").get()).toEqual({ refunded: 1 });
  });
});

describe("Step Functions orchestrator", () => {
  it("calls StartExecution with the job input JSON", async () => {
    const sent: unknown[] = [];
    const orchestrator = createSfnJobOrchestrator({
      stateMachineArn: "arn:aws:states:ap-south-1:1:stateMachine:test",
      region: "ap-south-1",
      client: { send: async (command: unknown) => { sent.push(command); return {}; } } as never,
    });
    const input: JobInput = {
      jobId: "job-1",
      accountId: "7",
      repo: "github.com/acme/widgets",
      commitSha: SHA,
      tier: "S",
      snapshotId: "0123456789abcdef0123456789abcdef",
      visibility: "public",
    };
    await orchestrator.start(input);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(StartExecutionCommand);
    const params = (sent[0] as StartExecutionCommand).input;
    expect(params.stateMachineArn).toContain("stateMachine:test");
    expect(JSON.parse(params.input ?? "")).toEqual(input);
  });
});

describe("HTTP routes", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "repohive-intake-http-"));
    Object.assign(process.env, {
      ...LOCAL_ENV,
      REPOHIVE_DATA_DIR: join(scratch, "data"),
      REPOHIVE_LEDGER: `file:${join(scratch, "ledger.json")}`,
    });
    resetAppConfigForTests();
    const db = openAppDatabase(":memory:");
    resetAppDatabaseForTests(db);
    seedAccount(db);
  });

  afterEach(() => {
    resetAppDatabaseForTests();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("requires a session for POST /api/index", async () => {
    const response = await indexPost(
      new Request("http://localhost/api/index", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ repo: "acme/widgets" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("returns 404 for an unknown job id", async () => {
    const response = await jobGet(new Request("http://localhost/api/jobs/nope"), {
      params: Promise.resolve({ jobId: "nope" }),
    });
    expect(response.status).toBe(404);
  });
});
