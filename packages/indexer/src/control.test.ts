/**
 * The control handler's four operations against the local ledger (hosting-4 Requirement 10.6).
 */
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { CONTROL_SLOT_MARGIN_MS, createControl, handler, parseControlEvent, type ControlEvent } from "./control.js";
import type { JobLedger } from "./job-ledger.js";
import { createMemoryJobLedger } from "./job-ledger-memory.js";
import type { JobInput } from "./job-types.js";
import { TIER_TIMEOUT_MS } from "./tiers.js";

function input(overrides: Partial<JobInput> = {}): JobInput {
  return {
    jobId: "job-1",
    accountId: "acct-1",
    repo: "github.com/acme/widgets",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    tier: "L",
    snapshotId: "0123456789abcdef0123456789abcdef",
    visibility: "public",
    ...overrides,
  };
}

describe("control operations", () => {
  let now: number;
  let ledger: JobLedger;
  let lines: string[];
  let control: (event: ControlEvent) => ReturnType<ReturnType<typeof createControl>>;

  beforeEach(() => {
    now = 1_000_000;
    lines = [];
    ledger = createMemoryJobLedger({ nowMs: () => now });
    control = createControl({ ledger, nowMs: () => now, write: (line) => lines.push(line) });
  });

  test("acquireSlot takes the large slot with a lease past the tier timeout", async () => {
    await ledger.claim(input());
    assert.deepEqual(await control({ op: "acquireSlot", jobId: "job-1", tier: "L" }), { op: "acquireSlot", acquired: true });
    // Another job cannot take it until just before the lease ends, and can just after.
    const lease = TIER_TIMEOUT_MS.L + CONTROL_SLOT_MARGIN_MS;
    now += lease - 1;
    assert.equal(await ledger.acquireLargeSlot("other", now + 1_000), false);
    now += 2;
    assert.equal(await ledger.acquireLargeSlot("other", now + 1_000), true);
  });

  test("acquireSlot is re-entrant: the job's own acquisition after the state machine's succeeds", async () => {
    await ledger.claim(input());
    await control({ op: "acquireSlot", jobId: "job-1", tier: "XL" });
    assert.deepEqual(await control({ op: "acquireSlot", jobId: "job-1", tier: "XL" }), { op: "acquireSlot", acquired: true });
    // What runJob does inside the task.
    assert.equal(await ledger.acquireLargeSlot("job-1", now + 60_000), true);
  });

  test("a refused acquireSlot moves a queued job to waiting-for-slot, once", async () => {
    await ledger.claim(input({ jobId: "holder", repo: "github.com/acme/holder" }));
    await ledger.claim(input());
    await control({ op: "acquireSlot", jobId: "holder", tier: "L" });

    assert.deepEqual(await control({ op: "acquireSlot", jobId: "job-1", tier: "L" }), { op: "acquireSlot", acquired: false });
    assert.equal((await ledger.get("job-1"))?.state, "waiting-for-slot");
    // The next poll finds it already waiting and does not try an invalid transition.
    assert.deepEqual(await control({ op: "acquireSlot", jobId: "job-1", tier: "L" }), { op: "acquireSlot", acquired: false });
    assert.equal((await ledger.get("job-1"))?.state, "waiting-for-slot");

    await control({ op: "releaseSlot", jobId: "holder" });
    assert.deepEqual(await control({ op: "acquireSlot", jobId: "job-1", tier: "L" }), { op: "acquireSlot", acquired: true });
  });

  test("acquireSlot rejects a missing or finished job", async () => {
    await assert.rejects(control({ op: "acquireSlot", jobId: "nope", tier: "L" }), /not open/);
    await ledger.claim(input());
    await ledger.finish("job-1", { state: "succeeded" });
    await assert.rejects(control({ op: "acquireSlot", jobId: "job-1", tier: "L" }), /not open/);
  });

  test("releaseSlot frees the slot only for the job that holds it", async () => {
    await ledger.claim(input());
    await control({ op: "acquireSlot", jobId: "job-1", tier: "L" });
    await control({ op: "releaseSlot", jobId: "someone-else" });
    assert.equal(await ledger.acquireLargeSlot("other", now + 1_000), false);
    assert.deepEqual(await control({ op: "releaseSlot", jobId: "job-1" }), { op: "releaseSlot", released: true });
    assert.equal(await ledger.acquireLargeSlot("other", now + 1_000), true);
  });

  test("inspect reports state, tier and the failure class and code", async () => {
    assert.deepEqual(await control({ op: "inspect", jobId: "job-1" }), { op: "inspect", state: "missing" });
    await ledger.claim(input({ tier: "M" }));
    assert.deepEqual(await control({ op: "inspect", jobId: "job-1" }), { op: "inspect", state: "queued", tier: "M" });
    await ledger.finish("job-1", { state: "failed", failureClass: "user", failureCode: "too-large" });
    assert.deepEqual(await control({ op: "inspect", jobId: "job-1" }), {
      op: "inspect",
      state: "failed",
      tier: "M",
      failureClass: "user",
      failureCode: "too-large",
    });
  });

  test("failIfOpen fails an open job as a system failure and releases the slot it holds", async () => {
    await ledger.claim(input());
    await control({ op: "acquireSlot", jobId: "job-1", tier: "L" });
    assert.deepEqual(await control({ op: "failIfOpen", jobId: "job-1", code: "runtime-timeout" }), {
      op: "failIfOpen",
      state: "failed",
      failed: true,
    });
    const record = await ledger.get("job-1");
    assert.equal(record?.state, "failed");
    assert.equal(record?.failureClass, "system");
    assert.equal(record?.failureCode, "runtime-timeout");
    assert.equal(await ledger.acquireLargeSlot("other", now + 1_000), true, "the slot is free");
    // The repository lock is released too, so a new job for it can be claimed.
    assert.deepEqual(await ledger.claim(input({ jobId: "job-2" })), { claimed: true, jobId: "job-2" });
    // A JobsFailed metric with Class=system, so the alarm sees a failure the job never reported.
    assert.equal(lines.length, 1);
    const emf = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    assert.equal(emf.Class, "system");
    assert.equal(emf.Tier, "L");
    assert.equal(emf.JobsFailed, 1);
  });

  test("failIfOpen leaves the slot of another job alone", async () => {
    await ledger.claim(input({ jobId: "holder", repo: "github.com/acme/holder" }));
    await ledger.claim(input());
    await control({ op: "acquireSlot", jobId: "holder", tier: "L" });
    await control({ op: "failIfOpen", jobId: "job-1", code: "slot-wait-timeout" });
    assert.equal(await ledger.acquireLargeSlot("other", now + 1_000), false, "the holder keeps the slot");
  });

  test("failIfOpen does nothing to a terminal job, and nothing to a job that does not exist", async () => {
    await ledger.claim(input());
    await ledger.finish("job-1", { state: "succeeded" });
    assert.deepEqual(await control({ op: "failIfOpen", jobId: "job-1", code: "runtime-error" }), {
      op: "failIfOpen",
      state: "succeeded",
      failed: false,
    });
    assert.equal((await ledger.get("job-1"))?.state, "succeeded");
    assert.equal((await ledger.get("job-1"))?.failureCode, undefined);

    await ledger.claim(input({ jobId: "job-2", repo: "github.com/acme/other" }));
    await ledger.finish("job-2", { state: "failed", failureClass: "user", failureCode: "too-large" });
    assert.deepEqual(await control({ op: "failIfOpen", jobId: "job-2", code: "runtime-error" }), {
      op: "failIfOpen",
      state: "failed",
      failed: false,
    });
    assert.equal((await ledger.get("job-2"))?.failureClass, "user");
    assert.equal((await ledger.get("job-2"))?.failureCode, "too-large");

    assert.deepEqual(await control({ op: "failIfOpen", jobId: "gone", code: "runtime-error" }), {
      op: "failIfOpen",
      state: "missing",
      failed: false,
    });
    assert.equal(lines.length, 0, "no failure metric for a job that was already terminal");
  });
});

describe("event parsing and the handler", () => {
  test("parseControlEvent names the first bad field", () => {
    assert.throws(() => parseControlEvent("x"), /must be an object/);
    assert.throws(() => parseControlEvent({ op: "inspect" }), /jobId/);
    assert.throws(() => parseControlEvent({ op: "shred", jobId: "j" }), /op must be/);
    assert.throws(() => parseControlEvent({ op: "acquireSlot", jobId: "j", tier: "S" }), /only L and XL/);
    assert.throws(() => parseControlEvent({ op: "failIfOpen", jobId: "j" }), /code/);
    assert.throws(() => parseControlEvent({ op: "failIfOpen", jobId: "j", code: "has space" }), /code must be/);
    assert.deepEqual(parseControlEvent({ op: "failIfOpen", jobId: "j", code: "runtime-error", extra: 1 }), {
      op: "failIfOpen",
      jobId: "j",
      code: "runtime-error",
    });
  });

  test("the Lambda handler reads the ledger from REPOHIVE_LEDGER and answers", async () => {
    const saved = process.env.REPOHIVE_LEDGER;
    process.env.REPOHIVE_LEDGER = "memory";
    try {
      assert.deepEqual(await handler({ op: "inspect", jobId: "nobody" }), { op: "inspect", state: "missing" });
      await assert.rejects(handler({ op: "inspect" }), TypeError);
    } finally {
      if (saved === undefined) delete process.env.REPOHIVE_LEDGER;
      else process.env.REPOHIVE_LEDGER = saved;
    }
  });
});
