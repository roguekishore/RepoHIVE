import type { JobInput } from "@repohive/indexer";

/** Starts an accepted job. */
export interface JobOrchestrator {
  start(input: JobInput): Promise<void>;
}
