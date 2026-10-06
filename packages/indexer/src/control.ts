/**
 * The control handler: ledger operations for the Step Functions state machine, behind
 * the same `JobLedger` interface the job uses, so the state machine never duplicates the table layout. It runs in
 * the indexer image with `image_config.command = ["dist/control.handler"]`.
 *
 * The event is `{ op, jobId, ... }`; the result is a small JSON object the state machine reads.
 */
import { ConfigError, createLedger, parseLedgerConfig } from "./config.js";
import type { JobLedger } from "./job-ledger.js";
import { isTerminalJobState } from "./job-ledger-states.js";
import type { FailureClass, JobState, Tier } from "./job-types.js";
import { TIER_TIMEOUT_MS } from "./tiers.js";
import { createTelemetry, type LineWriter } from "./telemetry.js";

/**
 * How long the state machine's slot lease outlives the tier timeout: provisioning and image pull (180 s) plus the 2-minute margin `runJob` uses for its own lease.
 */
export const CONTROL_SLOT_MARGIN_MS = 180_000 + 2 * 60_000;

export type ControlEvent =
  | { readonly op: "acquireSlot"; readonly jobId: string; readonly tier: Tier }
  | { readonly op: "releaseSlot"; readonly jobId: string }
  | { readonly op: "inspect"; readonly jobId: string }
  | { readonly op: "failIfOpen"; readonly jobId: string; readonly code: string };

export type ControlResult =
  | { readonly op: "acquireSlot"; readonly acquired: boolean }
  | { readonly op: "releaseSlot"; readonly released: true }
  | {
      readonly op: "inspect";
      /** `missing` when the ledger has no such job (never written, or expired). */
      readonly state: JobState | "missing";
      readonly tier?: Tier;
      readonly failureClass?: FailureClass;
      readonly failureCode?: string;
    }
  | { readonly op: "failIfOpen"; readonly state: JobState | "missing"; readonly failed: boolean };

const TIERS: readonly Tier[] = ["S", "M", "L", "XL"];
const CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/** The event as a typed value; throws a `TypeError` naming the first bad field. */
export function parseControlEvent(value: unknown): ControlEvent {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("control event must be an object");
  }
  const record = value as Record<string, unknown>;
  const text = (name: string): string => {
    const field = record[name];
    if (typeof field !== "string" || field === "") {
      throw new TypeError(`control event: ${name} must be a non-empty string`);
    }
    return field;
  };
  const jobId = text("jobId");
  switch (record.op) {
    case "acquireSlot": {
      const tier = text("tier");
      if (tier !== "L" && tier !== "XL") {
        throw new TypeError("control event: only L and XL jobs take the large slot");
      }
      return { op: "acquireSlot", jobId, tier };
    }
    case "releaseSlot":
      return { op: "releaseSlot", jobId };
    case "inspect":
      return { op: "inspect", jobId };
    case "failIfOpen": {
      const code = text("code");
      if (!CODE_PATTERN.test(code)) {
        throw new TypeError("control event: code must be 1 to 64 letters, digits, dots, dashes or underscores");
      }
      return { op: "failIfOpen", jobId, code };
    }
    default:
      throw new TypeError("control event: op must be acquireSlot, releaseSlot, inspect or failIfOpen");
  }
}

export interface ControlDeps {
  readonly ledger: JobLedger;
  readonly nowMs?: () => number;
  /** Where the `JobsFailed` metric line goes; default: stdout. */
  readonly write?: LineWriter;
}

/** The four operations over a ledger. */
export function createControl(deps: ControlDeps): (event: ControlEvent) => Promise<ControlResult> {
  const { ledger } = deps;
  const nowMs = deps.nowMs ?? ((): number => Date.now());

  return async (event) => {
    switch (event.op) {
      case "acquireSlot": {
        const job = await ledger.get(event.jobId);
        if (job === undefined || isTerminalJobState(job.state)) {
          throw new Error(`job ${event.jobId} is not open`);
        }
        const leaseUntil = nowMs() + TIER_TIMEOUT_MS[event.tier] + CONTROL_SLOT_MARGIN_MS;
        if (await ledger.acquireLargeSlot(event.jobId, leaseUntil)) {
          return { op: "acquireSlot", acquired: true };
        }
        // A forward move; a job already waiting (an earlier poll) stays where it is.
        if (job.state === "queued") {
          await ledger.transition(event.jobId, "waiting-for-slot");
        }
        return { op: "acquireSlot", acquired: false };
      }
      case "releaseSlot":
        await ledger.releaseLargeSlot(event.jobId);
        return { op: "releaseSlot", released: true };
      case "inspect": {
        const job = await ledger.get(event.jobId);
        if (job === undefined) {
          return { op: "inspect", state: "missing" };
        }
        return {
          op: "inspect",
          state: job.state,
          tier: job.input.tier,
          ...(job.failureClass === undefined ? {} : { failureClass: job.failureClass }),
          ...(job.failureCode === undefined ? {} : { failureCode: job.failureCode }),
        };
      }
      case "failIfOpen": {
        const job = await ledger.get(event.jobId);
        if (job === undefined) {
          return { op: "failIfOpen", state: "missing", failed: false };
        }
        if (isTerminalJobState(job.state)) {
          return { op: "failIfOpen", state: job.state, failed: false };
        }
        await ledger.finish(event.jobId, { state: "failed", failureClass: "system", failureCode: event.code });
        // Releases only when this job holds the slot.
        await ledger.releaseLargeSlot(event.jobId);
        createTelemetry({
          tier: job.input.tier,
          runtime: "lambda",
          ...(deps.write === undefined ? {} : { write: deps.write }),
        }).jobFailed("system");
        return { op: "failIfOpen", state: "failed", failed: true };
      }
    }
  };
}

let shared: ((event: ControlEvent) => Promise<ControlResult>) | undefined;

/** The Lambda entry point: the ledger comes from `REPOHIVE_LEDGER`, once per cold start. */
export async function handler(event: unknown): Promise<ControlResult> {
  const parsed = parseControlEvent(event);
  if (shared === undefined) {
    const config = parseLedgerConfig(process.env);
    if (config.kind === "dynamodb" && (process.env.AWS_REGION ?? "") === "") {
      throw new ConfigError("AWS_REGION is not set");
    }
    shared = createControl({ ledger: createLedger({ ledger: config }) });
  }
  return shared(parsed);
}
