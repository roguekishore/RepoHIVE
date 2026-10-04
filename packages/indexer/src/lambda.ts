// The thread pool is sized before anything else loads (see thread-pool.ts).
import "./thread-pool.js";
import type { Context } from "aws-lambda";
import { executeJob } from "./entry.js";
import { parseJobInput } from "./job-input.js";
import type { JobResult } from "./job-result.js";

/**
 * The Lambda entry point for S and M jobs. The event
 * is the job input; the time limit is the invocation's remaining time. The
 * outcome is reported to the server by `runJob` and the result is also returned.
 */
export async function handler(event: unknown, context: Pick<Context, "getRemainingTimeInMillis">): Promise<JobResult> {
  const input = parseJobInput(event);
  return executeJob(input, () => context.getRemainingTimeInMillis());
}
