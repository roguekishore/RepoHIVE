/**
 * The two-phase extraction pool: the default way the parser turns collected
 * source files into nodes and edges.
 *
 * **Phase 1** feeds files to worker threads from one queue, largest first (the
 * longest parses start earliest, so the tail is short). Disk reads happen here on
 * the main thread, at most `readConcurrency` in flight, and the bytes go
 * straight to an idle worker; the corpus is never gathered into one map. Workers
 * extract nodes and references and build their share of the symbol table. The
 * main thread merges the shares in canonical order.
 *
 * **Phase 2** hands every worker the merged table once, read-only (shared
 * memory, one copy), and each stitches the files it extracted.
 *
 * Determinism is structural. A worker only ever works on files it was handed;
 * every result is keyed by the file's index in the canonical list; the main
 * thread assembles nodes, errors and the symbol table in that order. Which
 * worker got which file, and in what order they finished, therefore reaches no
 * output byte. Edges come back unordered and the serializer sorts them.
 *
 * Failure: a worker that crashes or exits fails the run with a `worker-failed`
 * error, nothing is written, and every worker is terminated before the call
 * returns. A worker that reports an exception of its own surfaces as an ordinary
 * thrown error, which `parseProject` turns into `internal-error`.
 */

import { Worker } from "node:worker_threads";

import type { DependencyEdge, GraphNode } from "@repohive/shared";

import { err, makeError, ok, type ParseError, type Result } from "./errors.js";
import {
  NODE_STRIDE,
  ENTRY_STRIDE,
  decodeEdges,
  decodeEntries,
  decodeNodes,
  encodeSymbolTable,
  type ExtractionResultPayload,
  type FromWorker,
  type StitchedPayload,
  type ToWorker,
} from "./extraction-protocol.js";
import { decodeStrings } from "./string-table.js";
import { mergeSymbolEntries, type SymbolEntry } from "./symbol-table.js";
import type { CollectedFile } from "./types.js";

/** Where the pool gets a file's size and bytes, whatever the source is. */
export interface FileSource {
  /** Size in bytes, for largest-first scheduling. A rejection counts as 0. */
  size(file: CollectedFile): Promise<number>;
  /**
   * The file's bytes. The pipeline may take ownership of the returned array
   * (it is transferred to a worker), so return one the caller does not keep.
   * A rejection is reported as `file-unreadable`.
   */
  read(file: CollectedFile): Promise<Uint8Array>;
}

/** Everything one run of the extraction needs. */
export interface ExtractionInput {
  /** The files to process, in canonical order. */
  files: readonly CollectedFile[];
  source: FileSource;
  /** How many worker threads to use (at most one per file is spawned). */
  workers: number;
  /** How many reads may be in flight at once. */
  readConcurrency: number;
  /**
   * Called as files settle (extracted, or failed to read) with how many have
   * settled so far and how many there are. `completed` never decreases and the
   * last call has `completed === total`; an initial call reports 0. Runs on the
   * main thread between worker messages, so work it schedules can run while the
   * pool is still going. A throw fails the run; the pool is torn down and the
   * error rethrown.
   */
  onProgress?: (completed: number, total: number) => void;
  /**
   * Carry on past files that could not be read or parsed: they contribute no
   * nodes, entries or references, and come back on {@link ExtractionOutput.skipped}
   * instead of failing the run. Off, the first settled batch with any such error
   * returns them all and nothing is merged or stitched.
   */
  tolerateFileErrors?: boolean;
}

/** What a successful run produces. */
export interface ExtractionOutput {
  /** Every file's nodes, in canonical file order. */
  nodes: GraphNode[];
  /** Every resolved edge, unordered; the serializer sorts. */
  edges: DependencyEdge[];
  /** Cross-source-root resolution ambiguities, summed over every file. */
  crossScopeAmbiguities: number;
  /** Files skipped under `tolerateFileErrors`, in canonical file order. Absent otherwise. */
  skipped?: ParseError[];
}

/**
 * Extract, build the symbol table and stitch, over a list of files. On any
 * per-file error, returns every error in canonical file order and no output.
 */
export interface ExtractionPipeline {
  run(input: ExtractionInput): Promise<Result<ExtractionOutput, ParseError>>;
}

/** A worker died (crashed or exited) rather than reporting a failure of its own. */
class WorkerFailure extends Error {}

/** One thread, and the handler that receives its next message. */
interface PoolWorker {
  worker: Worker;
  onMessage: ((message: FromWorker) => void) | undefined;
}

/** The compiled worker module, next to this one. */
const DEFAULT_WORKER_URL = new URL("./extraction-worker.js", import.meta.url);

/** Options for {@link createWorkerPoolPipeline}; both exist for tests. */
export interface PoolOptions {
  /** The worker module to start. Defaults to the compiled `extraction-worker.js`. */
  workerUrl?: URL;
  /** Called with each worker as it is created, so a test can watch its lifecycle. */
  onWorker?: (worker: Worker) => void;
}

/** Create the default pipeline, backed by worker threads. */
export function createWorkerPoolPipeline(options: PoolOptions = {}): ExtractionPipeline {
  const workerUrl = options.workerUrl ?? DEFAULT_WORKER_URL;
  return { run: (input) => runPool(input, workerUrl, options.onWorker) };
}

/** A view the pipeline owns outright: whole buffer, not shared, so it can be transferred. */
function ownedView(bytes: Uint8Array): Uint8Array {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

/** Run `task` over `items` with at most `limit` in flight; results in item order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    for (;;) {
      // No await between the read and the increment, so no index is handed out twice.
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => lane()));
  return results;
}

async function runPool(
  input: ExtractionInput,
  workerUrl: URL,
  onWorker: ((worker: Worker) => void) | undefined,
): Promise<Result<ExtractionOutput, ParseError>> {
  const { files, source } = input;
  if (files.length === 0) {
    return ok({ nodes: [], edges: [], crossScopeAmbiguities: 0 });
  }

  // Largest first; ties by canonical index so the schedule itself is repeatable.
  const sizes = await mapLimit(files, input.readConcurrency, async (file) => {
    try {
      return await source.size(file);
    } catch {
      return 0;
    }
  });
  const order = files.map((_file, index) => index).sort((a, b) => (sizes[b] as number) - (sizes[a] as number) || a - b);

  const threadCount = Math.min(input.workers, files.length);
  const pool: PoolWorker[] = [];
  let closing = false;
  let fail: (error: Error) => void = () => undefined;
  const failure = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  // The flow below normally settles first; keep an unobserved rejection quiet.
  failure.catch(() => undefined);

  try {
    for (let i = 0; i < threadCount; i += 1) {
      const entry: PoolWorker = { worker: new Worker(workerUrl), onMessage: undefined };
      onWorker?.(entry.worker);
      entry.worker.on("message", (message: FromWorker) => {
        if (message.type === "failed") {
          fail(new Error(message.message));
        } else {
          entry.onMessage?.(message);
        }
      });
      entry.worker.on("error", (error) => {
        fail(new WorkerFailure(`a worker thread crashed: ${error.message}`));
      });
      entry.worker.on("exit", (code) => {
        if (!closing) {
          fail(new WorkerFailure(`a worker thread exited unexpectedly (code ${code})`));
        }
      });
      pool.push(entry);
    }

    const progress = input.onProgress;
    const guarded: ExtractionInput =
      progress === undefined
        ? input
        : {
            ...input,
            onProgress: (completed, total) => {
              try {
                progress(completed, total);
              } catch (cause) {
                fail(cause instanceof Error ? cause : new Error(String(cause)));
              }
            },
          };
    const driven = drive(guarded, order, pool);
    // If a worker fails first the race is already settled; keep the abandoned
    // flow from surfacing as an unhandled rejection.
    driven.catch(() => undefined);
    return await Promise.race([driven, failure]);
  } catch (cause) {
    if (cause instanceof WorkerFailure) {
      return err([makeError("worker-failed", cause.message)]);
    }
    throw cause;
  } finally {
    closing = true;
    await Promise.all(pool.map((entry) => entry.worker.terminate()));
  }
}

/** Ask one worker for something and wait for its next message. */
function request<T extends FromWorker["type"]>(
  entry: PoolWorker,
  message: ToWorker,
  expected: T,
): Promise<Extract<FromWorker, { type: T }>> {
  return new Promise((resolve, reject) => {
    entry.onMessage = (reply) => {
      entry.onMessage = undefined;
      if (reply.type === expected) {
        resolve(reply as Extract<FromWorker, { type: T }>);
      } else {
        reject(new Error(`unexpected message "${reply.type}" from a worker (expected "${expected}")`));
      }
    };
    entry.worker.postMessage(message);
  });
}

async function drive(
  input: ExtractionInput,
  order: readonly number[],
  pool: readonly PoolWorker[],
): Promise<Result<ExtractionOutput, ParseError>> {
  const { files } = input;

  // --- Phase 1: feed the queue ------------------------------------------------
  const errorsByFile = new Map<number, ParseError[]>();
  // Only a worker that was handed a file has anything to report or stitch. A
  // thread still starting up when the queue drains takes no further part.
  const used = new Set<PoolWorker>();
  await new Promise<void>((resolve) => {
    let nextRead = 0;
    let readsInFlight = 0;
    let settled = 0;
    const readyToSend: Array<{ fileIndex: number; bytes: Uint8Array }> = [];
    const idle: PoolWorker[] = [];
    // Reads ahead of the workers are bounded, so the corpus is never buffered whole.
    const bufferLimit = 2 * pool.length;

    const report = (): void => {
      input.onProgress?.(settled, files.length);
    };

    const pump = (): void => {
      while (idle.length > 0 && readyToSend.length > 0) {
        const entry = idle.pop() as PoolWorker;
        const job = readyToSend.shift() as { fileIndex: number; bytes: Uint8Array };
        const message: ToWorker = {
          type: "extract",
          fileIndex: job.fileIndex,
          relativePath: (files[job.fileIndex] as CollectedFile).relativePath,
          bytes: job.bytes,
        };
        used.add(entry);
        entry.worker.postMessage(message, [job.bytes.buffer as ArrayBuffer]);
      }
      while (nextRead < order.length && readsInFlight < input.readConcurrency && readyToSend.length < bufferLimit) {
        const fileIndex = order[nextRead] as number;
        nextRead += 1;
        readsInFlight += 1;
        const file = files[fileIndex] as CollectedFile;
        void (async () => input.source.read(file))().then(
          (bytes) => {
            readsInFlight -= 1;
            readyToSend.push({ fileIndex, bytes: ownedView(bytes) });
            pump();
          },
          () => {
            readsInFlight -= 1;
            errorsByFile.set(fileIndex, [
              makeError("file-unreadable", `Java source file could not be read: ${file.relativePath}`, file.relativePath),
            ]);
            settled += 1;
            report();
            pump();
          },
        );
      }
      if (settled === files.length) {
        resolve();
      }
    };

    for (const entry of pool) {
      entry.onMessage = (message) => {
        if (message.type === "ready") {
          idle.push(entry);
        } else if (message.type === "extracted") {
          if (message.errors.length > 0) {
            errorsByFile.set(message.fileIndex, message.errors);
          }
          settled += 1;
          idle.push(entry);
          report();
        }
        pump();
      };
    }
    // Start reading now rather than when the first worker reports in.
    report();
    pump();
  });

  // Every file has been tried. Errors go back in canonical file order, whatever
  // order the workers happened to report them in.
  const skipped: ParseError[] = [];
  if (errorsByFile.size > 0) {
    for (const fileIndex of [...errorsByFile.keys()].sort((a, b) => a - b)) {
      skipped.push(...(errorsByFile.get(fileIndex) as ParseError[]));
    }
    if (input.tolerateFileErrors !== true) {
      return err(skipped);
    }
  }

  // --- Merge phase 1, in canonical order --------------------------------------
  const active = pool.filter((entry) => used.has(entry));
  const results: ExtractionResultPayload[] = [];
  for (const reply of await Promise.all(
    active.map((entry) => request(entry, { type: "finish-extraction" }, "extraction-result")),
  )) {
    results.push(reply.result);
  }

  const nodesByFile = new Array<GraphNode[] | undefined>(files.length);
  const entriesByFile = new Array<SymbolEntry[] | undefined>(files.length);
  for (const result of results) {
    const strings = decodeStrings(result.strings);
    let nodeOffset = 0;
    let entryOffset = 0;
    for (let i = 0; i < result.fileIndices.length; i += 1) {
      const fileIndex = result.fileIndices[i] as number;
      const nodeCount = result.nodeCounts[i] as number;
      const entryCount = result.entryCounts[i] as number;
      nodesByFile[fileIndex] = decodeNodes(result.nodes, nodeOffset, nodeOffset + nodeCount, strings);
      entriesByFile[fileIndex] = decodeEntries(result.entries, entryOffset, entryOffset + entryCount, strings);
      nodeOffset += nodeCount;
      entryOffset += entryCount;
    }
    if (result.nodes.length !== nodeOffset * NODE_STRIDE || result.entries.length !== entryOffset * ENTRY_STRIDE) {
      throw new Error("a worker's extraction result is inconsistent with its own counts");
    }
  }

  const nodes: GraphNode[] = [];
  const orderedEntries: SymbolEntry[][] = [];
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const fileNodes = nodesByFile[fileIndex];
    const fileEntries = entriesByFile[fileIndex];
    if (fileNodes === undefined || fileEntries === undefined) {
      if (errorsByFile.has(fileIndex)) {
        continue; // skipped under tolerateFileErrors: it has no nodes by design
      }
      throw new Error(`no worker reported file ${(files[fileIndex] as CollectedFile).relativePath}`);
    }
    for (const node of fileNodes) {
      nodes.push(node);
    }
    orderedEntries.push(fileEntries);
  }

  // --- Phase 2: one read-only table, every worker stitches its own files -------
  const table = encodeSymbolTable(mergeSymbolEntries(orderedEntries));
  const stitched = await Promise.all(
    active.map((entry) => request(entry, { type: "stitch", table }, "stitched")),
  );

  const edges: DependencyEdge[] = [];
  let crossScopeAmbiguities = 0;
  for (const reply of stitched) {
    const payload: StitchedPayload = reply.result;
    for (const edge of decodeEdges(payload.strings, payload.edges)) {
      edges.push(edge);
    }
    crossScopeAmbiguities += payload.ambiguities;
  }

  return ok({ nodes, edges, crossScopeAmbiguities, skipped });
}
