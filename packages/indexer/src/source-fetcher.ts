/**
 * Getting a repository's selected sources into memory (hosting-2
 * Requirements 1.2 and 4). Network implementation: GitHub's tarball endpoint.
 * Local implementation: a `.tar.gz` file on disk, through the same stream path.
 *
 * Types only; the stream reader and its hardening land with the
 * implementations.
 */
import type { SourceEntry } from "@repohive/engine";
import type { JobFailure, Tier } from "./job-types.js";

/** What to fetch. Every field is validated before it reaches a URL (Requirement 4.1). */
export interface FetchRequest {
  readonly owner: string;
  readonly repo: string;
  readonly commitSha: string;
  /** The tier the job runs on; its caps bound the selected files and bytes. */
  readonly tier: Tier;
}

/** Hardening limits (Requirement 4.6). */
export interface FetchCaps {
  readonly maxDownloadedBytes: number;
  readonly maxDecompressedBytes: number;
  readonly maxEntries: number;
  readonly maxSelectedFileBytes: number;
  readonly timeoutMs: number;
}

/** The selected entries, as bytes, and what reading them cost. */
export interface FetchedSource {
  readonly entries: readonly SourceEntry[];
  readonly downloadedBytes: number;
  readonly decompressedBytes: number;
  readonly entryCount: number;
}

export type FetchResult =
  | { readonly ok: true; readonly source: FetchedSource }
  | { readonly ok: false; readonly failure: JobFailure }
  /** The selected files exceed the job's tier but fit this larger one (Requirement 3.5). */
  | { readonly ok: false; readonly retier: Tier };

export interface SourceFetcher {
  fetch(request: FetchRequest, caps: FetchCaps, signal?: AbortSignal): Promise<FetchResult>;
}
