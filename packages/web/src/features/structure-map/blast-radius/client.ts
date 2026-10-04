/**
 * The browser side. One session per
 * snapshot id fetches `/artifacts/<owner>/<repo>/<id>/views/blast-radius.json` once, on first use,
 * hands it to a Web Worker and answers queries through it. A re-index never
 * mixes snapshots because a session is bound to one id.
 *
 * `fetchData` and `createWorker` are injectable so the fetch-once behaviour is
 * testable without a browser.
 */
import type { BlastRadiusData } from "@repohive/views";
import { artifactPath } from "@/features/repository/repo-name";
import type { WorkerRequest, WorkerResponse } from "./messages";
import type { BlastRadiusResult } from "./traverse";

export interface BlastRadiusWorker {
  postMessage(message: WorkerRequest): void;
  addEventListener(type: "message", listener: (event: { data: WorkerResponse }) => void): void;
  terminate(): void;
}

interface BlastRadiusSessionOptions {
  repoId: string;
  snapshotId: string;
  fetchData?: (url: string) => Promise<BlastRadiusData>;
  createWorker?: () => BlastRadiusWorker;
}

export interface BlastRadiusSession {
  /** `null` when the node is not in the snapshot. */
  query(node: string): Promise<BlastRadiusResult | null>;
  dispose(): void;
}

async function fetchBlastRadiusData(url: string): Promise<BlastRadiusData> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`blast-radius view returned ${response.status}`);
  }
  return (await response.json()) as BlastRadiusData;
}

function createBrowserWorker(): BlastRadiusWorker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}

export function createBlastRadiusSession(options: BlastRadiusSessionOptions): BlastRadiusSession {
  const { repoId, snapshotId, fetchData = fetchBlastRadiusData, createWorker = createBrowserWorker } = options;
  const pending = new Map<number, { resolve: (r: BlastRadiusResult | null) => void; reject: (e: Error) => void }>();
  let nextRequestId = 1;
  let ready: Promise<BlastRadiusWorker> | undefined;
  let worker: BlastRadiusWorker | undefined;

  const start = (): Promise<BlastRadiusWorker> => {
    ready ??= (async () => {
      const data = await fetchData(artifactPath(repoId, snapshotId, "views/blast-radius.json"));
      const created = createWorker();
      worker = created;
      await new Promise<void>((resolve) => {
        created.addEventListener("message", (event) => {
          const message = event.data;
          if (message.type === "loaded") {
            resolve();
            return;
          }
          const entry = pending.get(message.requestId);
          if (entry === undefined) return;
          pending.delete(message.requestId);
          if (message.type === "result") entry.resolve(message.result);
          else entry.reject(new Error(message.message));
        });
        created.postMessage({ type: "load", data });
      });
      return created;
    })();
    // A failed first use must not poison later attempts.
    ready.catch(() => {
      ready = undefined;
    });
    return ready;
  };

  return {
    async query(node) {
      const active = await start();
      return new Promise((resolve, reject) => {
        const requestId = nextRequestId++;
        pending.set(requestId, { resolve, reject });
        active.postMessage({ type: "query", requestId, node });
      });
    },
    dispose() {
      worker?.terminate();
      for (const entry of pending.values()) entry.reject(new Error("blast-radius session disposed"));
      pending.clear();
      worker = undefined;
      ready = undefined;
    },
  };
}
