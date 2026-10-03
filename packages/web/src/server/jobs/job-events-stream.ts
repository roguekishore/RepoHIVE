/**
 * hosting-3 Requirement 9: SSE job progress from the ledger.
 */
import { isTerminalJobState, type JobLedger, type JobRecord } from "@repohive/indexer";
import { unregisterJobEventStream } from "./stream-registry";

export const JOB_EVENTS_POLL_MS = 1000;
export const JOB_EVENTS_HEARTBEAT_MS = 15_000;
export const JOB_EVENTS_MAX_DURATION_MS = 20 * 60_000;

export interface JobEventFrame {
  readonly id: number;
  readonly event: "progress" | "done";
  readonly data: Record<string, unknown>;
}

export function jobRecordToEventData(record: JobRecord): Record<string, unknown> {
  const base: Record<string, unknown> = {
    jobId: record.input.jobId,
    repo: record.input.repo,
    state: record.state,
  };
  if (record.progress !== undefined) {
    base.progress = record.progress;
  }
  if (record.state === "succeeded") {
    base.result = { snapshotId: record.input.snapshotId };
  }
  if (record.state === "failed" && record.failureCode !== undefined) {
    base.failure = { code: record.failureCode };
  }
  return base;
}

function formatSseFrame(frame: JobEventFrame): string {
  return `id: ${frame.id}\nevent: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`;
}

function parseLastEventId(header: string | null): number {
  if (header === null || header.trim() === "") {
    return 0;
  }
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function createJobEventsStream(
  ledger: JobLedger,
  jobId: string,
  ip: string,
  streamId: string,
  request: Request,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let eventId = 0;
  let lastSentId = parseLastEventId(request.headers.get("Last-Event-ID"));
  let lastPayload = "";
  const startedAt = Date.now();
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const closeStream = () => {
        if (closed) {
          return;
        }
        closed = true;
        if (pollTimer !== undefined) {
          clearInterval(pollTimer);
        }
        if (heartbeatTimer !== undefined) {
          clearInterval(heartbeatTimer);
        }
        unregisterJobEventStream(ip, streamId);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      const pushFrame = (frame: JobEventFrame) => {
        if (frame.id <= lastSentId) {
          return;
        }
        const serialized = formatSseFrame(frame);
        if (serialized === lastPayload && frame.event === "progress") {
          return;
        }
        lastPayload = serialized;
        lastSentId = frame.id;
        controller.enqueue(encoder.encode(serialized));
      };

      const poll = async () => {
        if (closed) {
          return;
        }
        if (Date.now() - startedAt >= JOB_EVENTS_MAX_DURATION_MS) {
          closeStream();
          return;
        }
        const record = await ledger.get(jobId);
        if (record === undefined) {
          eventId += 1;
          pushFrame({
            id: eventId,
            event: "done",
            data: { jobId, state: "failed", failure: { code: "NOT_FOUND" } },
          });
          closeStream();
          return;
        }
        eventId += 1;
        const event: JobEventFrame["event"] = isTerminalJobState(record.state) ? "done" : "progress";
        pushFrame({ id: eventId, event, data: jobRecordToEventData(record) });
        if (isTerminalJobState(record.state)) {
          closeStream();
        }
      };

      void poll();
      pollTimer = setInterval(() => {
        void poll();
      }, JOB_EVENTS_POLL_MS);

      heartbeatTimer = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }
      }, JOB_EVENTS_HEARTBEAT_MS);

      request.signal.addEventListener("abort", closeStream);
    },
    cancel() {
      unregisterJobEventStream(ip, streamId);
    },
  });
}
