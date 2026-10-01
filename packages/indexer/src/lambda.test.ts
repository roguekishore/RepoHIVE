/**
 * The Lambda entry point (hosting-2 Requirement 3.3 and the guide's "Thread pool").
 */
import assert from "node:assert/strict";
import { availableParallelism } from "node:os";
import { test } from "node:test";
import { handler } from "./lambda.js";

test("importing an entry point sizes the libuv thread pool to the vCPU count", () => {
  assert.equal(process.env.UV_THREADPOOL_SIZE, String(availableParallelism()));
});

test("the handler rejects an event that is not a job input, before touching any service", async () => {
  const context = { getRemainingTimeInMillis: () => 60_000 };
  await assert.rejects(handler({}, context), /job input/);
  await assert.rejects(handler({ jobId: "j", tier: "S" }, context), TypeError);
});
