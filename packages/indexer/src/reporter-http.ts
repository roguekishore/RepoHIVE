/**
 * The HTTP {@link JobReporter} and active-snapshot reader: the worker's only channel to the server
 *. Auth is `Authorization: Bearer <secret>`. The secret is never put in an
 * error message or a log line.
 */
import type { FetchFunction } from "./github.js";
import type { JobOutcome, JobProgress, JobReporter } from "./job-reporter.js";
import { PROGRESS_WRITE_INTERVAL_MS } from "./job-states.js";
import type { JobState } from "./job-types.js";

/** Attempts per request, and the waits between them. */
export const REPORT_ATTEMPTS = 3;
export const REPORT_BACKOFF_MS: readonly number[] = [1000, 2000];
const REQUEST_TIMEOUT_MS = 15_000;

export interface HttpJobReporterOptions {
  readonly serverUrl: string;
  readonly secret: string;
  readonly fetch?: FetchFunction;
  /** Default: a timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Milliseconds since any fixed point; default `Date.now`. */
  readonly now?: () => number;
  /** Where a dropped report is noted; default: one JSON line on stderr. Never receives the secret. */
  readonly warn?: (message: string) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const defaultWarn = (message: string): void => {
  process.stderr.write(`${JSON.stringify({ level: "warn", message })}\n`);
};

const trimSlash = (url: string): string => url.replace(/\/+$/, "");

type SendResult = { readonly kind: "ok" } | { readonly kind: "closed" } | { readonly kind: "error"; readonly detail: string };

export function createHttpJobReporter(options: HttpJobReporterOptions): JobReporter {
  const base = trimSlash(options.serverUrl);
  const doFetch: FetchFunction = options.fetch ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const warn = options.warn ?? defaultWarn;

  const lastSentAt = new Map<string, number>();
  const pending = new Map<string, JobProgress>();
  const closed = new Set<string>();

  /** One POST with retries on a network error or a 5xx. */
  async function post(path: string, body: unknown): Promise<SendResult> {
    let detail = "";
    for (let attempt = 1; attempt <= REPORT_ATTEMPTS; attempt += 1) {
      try {
        const response = await doFetch(`${base}${path}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.secret}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.status === 409) {
          return { kind: "closed" };
        }
        if (response.ok) {
          return { kind: "ok" };
        }
        detail = `HTTP ${response.status}`;
        if (response.status < 500) {
          return { kind: "error", detail };
        }
      } catch (error) {
        detail = `network error (${error instanceof Error ? error.name : "unknown"})`;
      }
      if (attempt < REPORT_ATTEMPTS) {
        await sleep(REPORT_BACKOFF_MS[attempt - 1] ?? 2000);
      }
    }
    return { kind: "error", detail };
  }

  async function sendProgress(jobId: string, state: JobState | undefined, progress: JobProgress | undefined): Promise<void> {
    lastSentAt.set(jobId, now());
    const result = await post("/api/internal/jobs/progress", {
      jobId,
      ...(state === undefined ? {} : { state }),
      ...(progress === undefined ? {} : { progress }),
    });
    if (result.kind === "closed") {
      closed.add(jobId);
      pending.delete(jobId);
    } else if (result.kind === "error") {
      warn(`progress report dropped: ${result.detail}`);
    }
  }

  return {
    async progress(jobId, update): Promise<void> {
      if (closed.has(jobId)) {
        return;
      }
      if (update.state !== undefined) {
        const merged = update.progress ?? pending.get(jobId);
        pending.delete(jobId);
        await sendProgress(jobId, update.state, merged);
        return;
      }
      if (update.progress === undefined) {
        return;
      }
      const last = lastSentAt.get(jobId);
      if (last === undefined || now() - last >= PROGRESS_WRITE_INTERVAL_MS) {
        pending.delete(jobId);
        await sendProgress(jobId, undefined, update.progress);
      } else {
        pending.set(jobId, update.progress);
      }
    },

    async complete(jobId, outcome): Promise<void> {
      const waiting = pending.get(jobId);
      if (waiting !== undefined && !closed.has(jobId)) {
        pending.delete(jobId);
        await sendProgress(jobId, undefined, waiting);
      }
      pending.delete(jobId);
      const result = await post("/api/internal/jobs/complete", { jobId, ...outcome });
      if (result.kind === "error") {
        throw new Error(`could not report the job outcome: ${result.detail}`);
      }
      closed.add(jobId);
    },
  };
}

export interface HttpActiveSnapshotReaderOptions {
  readonly serverUrl: string;
  readonly secret: string;
  readonly fetch?: FetchFunction;
}

const REPO_KEY = /^github\.com\/([a-z0-9-]{1,39})\/([a-z0-9._-]{1,100})$/;

/** Reads the snapshot the server currently serves for a repo key, or `undefined` when none. Throws on any failure. */
export function createHttpActiveSnapshotReader(
  options: HttpActiveSnapshotReaderOptions,
): (repo: string) => Promise<string | undefined> {
  const base = trimSlash(options.serverUrl);
  const doFetch: FetchFunction = options.fetch ?? ((url, init) => fetch(url, init));
  return async (repo) => {
    const match = REPO_KEY.exec(repo);
    if (match === null || match[2] === "." || match[2] === "..") {
      throw new RangeError(`not a canonical repo key: ${JSON.stringify(repo)}`);
    }
    let response: Response;
    try {
      response = await doFetch(`${base}/api/internal/repos/${match[1]}/${match[2]}/active`, {
        method: "GET",
        headers: { Authorization: `Bearer ${options.secret}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`could not read the active snapshot: network error (${error instanceof Error ? error.name : "unknown"})`);
    }
    if (!response.ok) {
      throw new Error(`could not read the active snapshot: HTTP ${response.status}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error("could not read the active snapshot: the response is not JSON");
    }
    const id = (body as { snapshotId?: unknown } | null)?.snapshotId;
    if (id === null || id === undefined) {
      return undefined;
    }
    if (typeof id !== "string") {
      throw new Error("could not read the active snapshot: malformed response");
    }
    return id;
  };
}
