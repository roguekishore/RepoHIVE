import type { JobInput } from "@repohive/indexer";

/** Starts an accepted job (Requirement 8.6). */
export interface JobOrchestrator {
  start(input: JobInput): Promise<void>;
}
