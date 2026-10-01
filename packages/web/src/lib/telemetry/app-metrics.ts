/**
 * Intake and account metrics in `RepoHIVE/Hosted`.
 */
import { readFileSync } from "node:fs";
import { METRIC_NAMESPACE, type LineWriter, stdoutWriter } from "@repohive/indexer";

const INFLIGHT_PK = "INFLIGHT";
import type { AppConfig } from "@/lib/hosting/config";

type Unit = "Count";

export type AppMetricName =
  | "JobsAccepted"
  | "JobsRejected"
  | "JobsCacheHit"
  | "JobsJoined"
  | "InFlight"
  | "SignUps";

export interface AppTelemetry {
  jobsAccepted(): void;
  jobsCacheHit(): void;
  jobsJoined(): void;
  jobsRejected(reason: string): void;
  signUp(): void;
  inFlight(count: number): void;
}

export interface AppTelemetryOptions {
  readonly write?: LineWriter;
  readonly now?: () => number;
  readonly config?: AppConfig;
}

function emit(
  write: LineWriter,
  now: () => number,
  name: AppMetricName,
  value: number,
  extra: Record<string, string> = {},
): void {
  const dimensions = { Component: "app", ...extra };
  write(
    JSON.stringify({
      _aws: {
        Timestamp: now(),
        CloudWatchMetrics: [
          {
            Namespace: METRIC_NAMESPACE,
            Dimensions: [Object.keys(dimensions)],
            Metrics: [{ Name: name, Unit: "Count" satisfies Unit }],
          },
        ],
      },
      ...dimensions,
      [name]: value,
    }),
  );
}

export function readGlobalInflightCount(config: AppConfig): number {
  if (config.ledger.kind !== "file") {
    return 0;
  }
  try {
    const raw = readFileSync(config.ledger.path, "utf8");
    const parsed = JSON.parse(raw) as { rows?: Record<string, { kind?: string; count?: number }> };
    const row = parsed.rows?.[INFLIGHT_PK];
    if (row?.kind === "inflight" && typeof row.count === "number" && row.count >= 0) {
      return row.count;
    }
    return 0;
  } catch {
    return 0;
  }
}

let cachedTelemetry: AppTelemetry | undefined;

export function getAppTelemetry(options: AppTelemetryOptions = {}): AppTelemetry {
  if (options.write === undefined && options.now === undefined && options.config === undefined && cachedTelemetry) {
    return cachedTelemetry;
  }
  const write = options.write ?? stdoutWriter;
  const now = options.now ?? Date.now;
  const config = options.config;

  const telemetry: AppTelemetry = {
    jobsAccepted: () => emit(write, now, "JobsAccepted", 1),
    jobsCacheHit: () => emit(write, now, "JobsCacheHit", 1),
    jobsJoined: () => emit(write, now, "JobsJoined", 1),
    jobsRejected: (reason) => emit(write, now, "JobsRejected", 1, { Reason: sanitizeReason(reason) }),
    signUp: () => emit(write, now, "SignUps", 1),
    inFlight: (count) => emit(write, now, "InFlight", Math.max(0, Math.round(count))),
  };

  if (options.write === undefined && options.now === undefined && options.config === undefined) {
    cachedTelemetry = telemetry;
  }
  return telemetry;
}

function sanitizeReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return "UNKNOWN";
  }
  return trimmed.replace(/[^A-Z0-9_]/gi, "_").slice(0, 64).toUpperCase();
}

export function recordIntakeMetrics(outcomeKind: string, reason: string | undefined, config: AppConfig): void {
  const telemetry = getAppTelemetry({ config });
  telemetry.inFlight(readGlobalInflightCount(config));
  switch (outcomeKind) {
    case "accepted":
      telemetry.jobsAccepted();
      break;
    case "cached":
      telemetry.jobsCacheHit();
      break;
    case "joined":
      telemetry.jobsJoined();
      break;
    case "rejected":
    case "busy":
      telemetry.jobsRejected(reason ?? outcomeKind.toUpperCase());
      break;
    default:
      break;
  }
}
