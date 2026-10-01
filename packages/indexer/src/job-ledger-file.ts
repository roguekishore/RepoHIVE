/**
 * File-backed {@link JobLedger} (`file:<path>` config, hosting-2 Requirement 10).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { JobLedger } from "./job-ledger.js";
import {
  createMemoryJobLedger,
  type MemoryJobLedger,
  type MemoryJobLedgerOptions,
  type Row,
} from "./job-ledger-memory.js";

export interface FileJobLedgerOptions extends MemoryJobLedgerOptions {
  readonly path: string;
}

type Persisted = {
  readonly version: 1;
  readonly rows: Record<string, Row>;
};

function loadRows(path: string): Map<string, Row> {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed.version !== 1 || typeof parsed.rows !== "object" || parsed.rows === null) {
      throw new Error(`invalid ledger file: ${path}`);
    }
    return new Map(Object.entries(parsed.rows));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw error;
  }
}

function saveRows(path: string, rows: Map<string, Row>): void {
  mkdirSync(dirname(path), { recursive: true });
  const payload: Persisted = { version: 1, rows: Object.fromEntries(rows) };
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(payload), "utf8");
  renameSync(temp, path);
}

function hydrate(path: string, options: MemoryJobLedgerOptions): MemoryJobLedger {
  const ledger = createMemoryJobLedger(options);
  const loaded = loadRows(path);
  for (const [key, value] of loaded) {
    ledger.rows.set(key, value);
  }
  return ledger;
}

/**
 * Persists the in-memory row map on every operation. Single-process local runs only.
 */
export function createFileJobLedger(options: FileJobLedgerOptions): JobLedger {
  const path = options.path;

  async function withStore<T>(fn: (ledger: MemoryJobLedger) => Promise<T>): Promise<T> {
    const inner = hydrate(path, options);
    const result = await fn(inner);
    saveRows(path, inner.rows);
    return result;
  }

  return {
    claim: (input) => withStore((l) => l.claim(input)),
    get: (jobId) => withStore((l) => l.get(jobId)),
    transition: (jobId, to) => withStore((l) => l.transition(jobId, to)),
    writeProgress: (jobId, progress) => withStore((l) => l.writeProgress(jobId, progress)),
    requeue: (jobId, tier) => withStore((l) => l.requeue(jobId, tier)),
    finish: (jobId, end) => withStore((l) => l.finish(jobId, end)),
    acquireLargeSlot: (jobId, leaseUntilMs) => withStore((l) => l.acquireLargeSlot(jobId, leaseUntilMs)),
    releaseLargeSlot: (jobId) => withStore((l) => l.releaseLargeSlot(jobId)),
  };
}
