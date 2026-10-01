/**
 * Validates a job input that arrives as untyped JSON (a Lambda event or the
 * Fargate `REPOHIVE_JOB_INPUT` variable).
 */
import type { JobInput, Tier } from "./job-types.js";

const TIERS: readonly Tier[] = ["S", "M", "L", "XL"];

/** The input as a typed value; throws a `TypeError` naming the first bad field. */
export function parseJobInput(value: unknown): JobInput {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("job input must be an object");
  }
  const record = value as Record<string, unknown>;
  const text = (name: string): string => {
    const field = record[name];
    if (typeof field !== "string" || field === "") {
      throw new TypeError(`job input: ${name} must be a non-empty string`);
    }
    return field;
  };
  const tier = text("tier");
  if (!TIERS.includes(tier as Tier)) {
    throw new TypeError("job input: tier must be S, M, L or XL");
  }
  if (record.visibility !== "public") {
    throw new TypeError("job input: visibility must be public");
  }
  return {
    jobId: text("jobId"),
    accountId: text("accountId"),
    repo: text("repo"),
    commitSha: text("commitSha"),
    tier: tier as Tier,
    snapshotId: text("snapshotId"),
    visibility: "public",
  };
}
