/**
 * Shared {@link JobLedger} contract (hosting-2 Requirement 10.7).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, test } from "node:test";
import type { JobLedger } from "./job-ledger.js";
import type { JobInput } from "./job-types.js";
import { createDynamoDbJobLedger } from "./job-ledger-dynamodb.js";
import { createFakeDynamoDbClient } from "./job-ledger-fake-dynamodb.js";
import { createFileJobLedger } from "./job-ledger-file.js";
import { createMemoryJobLedger } from "./job-ledger-memory.js";
import { PROGRESS_WRITE_INTERVAL_MS } from "./job-ledger-states.js";

function sampleInput(overrides: Partial<JobInput> = {}): JobInput {
  return {
    jobId: "job-1",
    accountId: "acct-1",
    repo: "github.com/acme/widgets",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    tier: "S",
    snapshotId: "0123456789abcdef0123456789abcdef",
    visibility: "public",
    ...overrides,
  };
}

async function runPipeline(ledger: JobLedger, jobId: string): Promise<void> {
  await ledger.transition(jobId, "waiting-for-slot");
  await ledger.transition(jobId, "fetching");
  await ledger.transition(jobId, "parsing");
  await ledger.transition(jobId, "grouping");
  await ledger.transition(jobId, "building-views");
  await ledger.transition(jobId, "publishing");
}

function registerContractSuite(name: string, createLedger: () => JobLedger): void {
  describe(`JobLedger contract (${name})`, () => {
    let ledger: JobLedger;

    beforeEach(() => {
      ledger = createLedger();
    });

    test("claim creates a queued job", async () => {
      const input = sampleInput();
      const result = await ledger.claim(input);
      assert.deepEqual(result, { claimed: true, jobId: "job-1" });
      const record = await ledger.get("job-1");
      assert.ok(record);
      assert.equal(record.state, "queued");
      assert.deepEqual(record.input, input);
      assert.ok(record.createdAt);
      assert.equal(record.updatedAt, record.createdAt);
    });

    test("claim rejects a second job for the same repository", async () => {
      await ledger.claim(sampleInput());
      const second = await ledger.claim(sampleInput({ jobId: "job-2" }));
      assert.deepEqual(second, { claimed: false, reason: "repo-in-flight", jobId: "job-1" });
    });

    test("claim rejects when the in-flight cap is reached", async () => {
      const small =
        name === "memory"
          ? createMemoryJobLedger({ inflightCap: 1 })
          : name === "file"
            ? createFileJobLedger({
                inflightCap: 1,
                path: join(fileDir, `cap-${Math.random().toString(36).slice(2)}.json`),
              })
            : createDynamoDbJobLedger(createFakeDynamoDbClient(), {
                tableName: "t-cap",
                inflightCap: 1,
              });
      await small.claim(sampleInput({ jobId: "a", repo: "github.com/acme/a" }));
      const blocked = await small.claim(sampleInput({ jobId: "b", repo: "github.com/acme/b" }));
      assert.deepEqual(blocked, { claimed: false, reason: "inflight-cap" });
    });

    test("forward transitions are accepted", async () => {
      await ledger.claim(sampleInput());
      await ledger.transition("job-1", "waiting-for-slot");
      await ledger.transition("job-1", "fetching");
      const record = await ledger.get("job-1");
      assert.equal(record?.state, "fetching");
    });

    test("backward and repeat transitions are rejected", async () => {
      await ledger.claim(sampleInput());
      await ledger.transition("job-1", "waiting-for-slot");
      await assert.rejects(() => ledger.transition("job-1", "queued"));
      await assert.rejects(() => ledger.transition("job-1", "waiting-for-slot"));
    });

    test("requeue returns a job to queued on a new tier", async () => {
      await ledger.claim(sampleInput({ tier: "S" }));
      await ledger.transition("job-1", "fetching");
      await ledger.requeue("job-1", "M");
      const record = await ledger.get("job-1");
      assert.equal(record?.state, "queued");
      assert.equal(record?.input.tier, "M");
    });

    test("finish releases the repository lock and allows a new claim", async () => {
      await ledger.claim(sampleInput());
      await runPipeline(ledger, "job-1");
      await ledger.finish("job-1", { state: "succeeded" });
      const done = await ledger.get("job-1");
      assert.equal(done?.state, "succeeded");
      assert.ok(done?.endedAt);
      assert.ok(done?.expiresAt);
      const again = await ledger.claim(sampleInput({ jobId: "job-2" }));
      assert.deepEqual(again, { claimed: true, jobId: "job-2" });
    });

    test("finish records a failure", async () => {
      await ledger.claim(sampleInput());
      await ledger.finish("job-1", { state: "failed", failureClass: "user", failureCode: "too-large" });
      const record = await ledger.get("job-1");
      assert.equal(record?.state, "failed");
      assert.equal(record?.failureClass, "user");
      assert.equal(record?.failureCode, "too-large");
    });

    test("writeProgress is throttled to once every two seconds", async () => {
      let t = 1_000_000;
      const timed =
        name === "memory"
          ? createMemoryJobLedger({ nowMs: () => t })
          : name === "file"
            ? createFileJobLedger({
                path: join(fileDir, `progress-${Math.random().toString(36).slice(2)}.json`),
                nowMs: () => t,
              })
            : createDynamoDbJobLedger(createFakeDynamoDbClient(), {
                tableName: "t-progress",
                nowMs: () => t,
              });
      await timed.claim(sampleInput());
      await timed.writeProgress("job-1", { stage: "parse", completed: 1, total: 10 });
      await timed.writeProgress("job-1", { stage: "parse", completed: 2, total: 10 });
      t += PROGRESS_WRITE_INTERVAL_MS - 1;
      await timed.writeProgress("job-1", { stage: "parse", completed: 3, total: 10 });
      let record = await timed.get("job-1");
      assert.equal(record?.progress?.completed, 1);
      t += 2;
      await timed.writeProgress("job-1", { stage: "parse", completed: 4, total: 10 });
      record = await timed.get("job-1");
      assert.equal(record?.progress?.completed, 4);
    });

    test("the large slot is exclusive until the lease expires", async () => {
      let t = 5_000;
      const timed =
        name === "memory"
          ? createMemoryJobLedger({ nowMs: () => t })
          : name === "file"
            ? createFileJobLedger({
                path: join(fileDir, `slot-${Math.random().toString(36).slice(2)}.json`),
                nowMs: () => t,
              })
            : createDynamoDbJobLedger(createFakeDynamoDbClient(), {
                tableName: "t-slot",
                nowMs: () => t,
              });
      assert.equal(await timed.acquireLargeSlot("job-a", 10_000), true);
      assert.equal(await timed.acquireLargeSlot("job-b", 10_000), false);
      t = 10_001;
      assert.equal(await timed.acquireLargeSlot("job-b", 20_000), true);
      await timed.releaseLargeSlot("job-b");
      assert.equal(await timed.acquireLargeSlot("job-c", 30_000), true);
    });
  });
}

const fileDir = mkdtempSync(join(tmpdir(), "repohive-ledger-"));
after(() => {
  rmSync(fileDir, { recursive: true, force: true });
});

registerContractSuite("memory", () => createMemoryJobLedger());
registerContractSuite("file", () =>
  createFileJobLedger({ path: join(fileDir, `ledger-${Math.random().toString(36).slice(2)}.json`) }),
);
registerContractSuite("dynamodb", () =>
  createDynamoDbJobLedger(createFakeDynamoDbClient(), { tableName: "repohive-jobs" }),
);
