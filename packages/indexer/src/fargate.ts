// The thread pool is sized before anything else loads (see thread-pool.ts).
import "./thread-pool.js";
import { executeJob } from "./entry.js";
import { parseJobInput } from "./job-input.js";

/**
 * The Fargate task entry point for L and XL jobs (hosting-2 Requirement 3.3).
 * The input is JSON in `REPOHIVE_JOB_INPUT`; the time limit is
 * `REPOHIVE_TIME_LIMIT_MS` counted from process start. The result goes to the
 * ledger; the exit code is 0 for `succeeded` and `retier`, 1 for `failed`.
 */
async function main(): Promise<number> {
  const started = Date.now();
  const limit = Number(process.env.REPOHIVE_TIME_LIMIT_MS);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("REPOHIVE_TIME_LIMIT_MS must be a positive number of milliseconds");
  }
  const raw = process.env.REPOHIVE_JOB_INPUT;
  if (raw === undefined || raw === "") {
    throw new Error("REPOHIVE_JOB_INPUT is not set");
  }
  const input = parseJobInput(JSON.parse(raw) as unknown);
  const result = await executeJob(input, () => limit - (Date.now() - started));
  return result.status === "failed" ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // Configuration or input errors: before any job state exists.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ level: "error", message })}\n`);
    process.exitCode = 1;
  },
);
