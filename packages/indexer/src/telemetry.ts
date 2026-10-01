/**
 * Telemetry (hosting-2 Requirement 11): a fixed set of CloudWatch embedded-metric
 * lines on stdout in the namespace `RepoHIVE/Hosted`, and JSON-line logs with the
 * job id. Dimensions are limited to `Tier`, `Runtime`, `Class` and `Stage`; no
 * repository, URL, account or IP ever appears in a metric, and logs never carry
 * a token or secret.
 */
import type { Tier } from "./job-types.js";

export const METRIC_NAMESPACE = "RepoHIVE/Hosted";

export type Runtime = "lambda" | "fargate" | "local";
export type StageName = "fetch" | "parse" | "group" | "views" | "publish";
export const STAGE_NAMES: readonly StageName[] = ["fetch", "parse", "group", "views", "publish"];

type Unit = "Count" | "Milliseconds" | "Megabytes";

/** Where lines go: stdout in the runtimes, a collector in tests. */
export type LineWriter = (line: string) => void;

export const stdoutWriter: LineWriter = (line) => {
  process.stdout.write(`${line}\n`);
};

export interface Telemetry {
  jobSucceeded(): void;
  jobFailed(failureClass: "user" | "system"): void;
  stageMs(stage: StageName, ms: number): void;
  endToEndMs(ms: number): void;
  peakRssMb(mb: number): void;
}

export interface TelemetryOptions {
  readonly tier: Tier;
  readonly runtime: Runtime;
  readonly write?: LineWriter;
  readonly now?: () => number;
}

export function createTelemetry(options: TelemetryOptions): Telemetry {
  const write = options.write ?? stdoutWriter;
  const now = options.now ?? Date.now;
  const base = { Tier: options.tier, Runtime: options.runtime };

  function emit(name: string, unit: Unit, value: number, extra: Record<string, string> = {}): void {
    const dimensions = { ...base, ...extra };
    write(
      JSON.stringify({
        _aws: {
          Timestamp: now(),
          CloudWatchMetrics: [
            { Namespace: METRIC_NAMESPACE, Dimensions: [Object.keys(dimensions)], Metrics: [{ Name: name, Unit: unit }] },
          ],
        },
        ...dimensions,
        [name]: value,
      }),
    );
  }

  return {
    jobSucceeded: () => emit("JobsSucceeded", "Count", 1),
    jobFailed: (failureClass) => emit("JobsFailed", "Count", 1, { Class: failureClass }),
    stageMs: (stage, ms) => emit("StageMs", "Milliseconds", Math.round(ms), { Stage: stage }),
    endToEndMs: (ms) => emit("EndToEndMs", "Milliseconds", Math.round(ms)),
    peakRssMb: (mb) => emit("PeakRssMb", "Megabytes", Math.round(mb)),
  };
}

export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  readonly jobId: string;
  /** Strings that must never appear in a line (the GitHub token, for one). */
  readonly secrets?: readonly string[];
  readonly write?: LineWriter;
  readonly now?: () => number;
}

const SECRET_KEY = /token|secret|authorization|password|credential/i;

/** JSON-line logger: every line carries the job id; secrets are replaced wherever they occur. */
export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? stdoutWriter;
  const now = options.now ?? Date.now;
  const secrets = (options.secrets ?? []).filter((secret) => secret.length >= 4);

  const scrub = (text: string): string => secrets.reduce((out, secret) => out.split(secret).join("[redacted]"), text);

  return {
    log(level, message, fields = {}) {
      const safe: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fields)) {
        safe[key] = SECRET_KEY.test(key) ? "[redacted]" : value;
      }
      // Caller fields never override the fixed ones.
      write(scrub(JSON.stringify({ ...safe, time: new Date(now()).toISOString(), level, jobId: options.jobId, message })));
    },
  };
}

export const silentLogger: Logger = { log() {} };
