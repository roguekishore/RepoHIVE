/**
 * The public job view the server returns for `GET /api/jobs/<jobId>`, as the
 * browser reads it. Client-safe: no import from the engine or the indexer.
 */

/** The fine-grained job states the server reports. */
export type JobState =
  | "queued"
  | "waiting-for-slot"
  | "fetching"
  | "parsing"
  | "grouping"
  | "building-views"
  | "publishing"
  | "succeeded"
  | "failed";

export interface JobProgress {
  readonly stage?: string;
  readonly completed?: number;
  readonly total?: number;
}

export interface PublicJobResponse {
  readonly repo: string;
  readonly state: JobState;
  readonly progress?: JobProgress;
  readonly result?: { readonly snapshotId: string };
  readonly failure?: { readonly code: string; readonly message: string };
}

/** `github.com/<owner>/<repo>` to `/repos/<owner>/<repo>/knowledge-graph`. */
export function repoKeyToViewerPath(repoKey: string): string | undefined {
  const match = /^github\.com\/([^/]+)\/([^/]+)$/u.exec(repoKey);
  if (match === null) {
    return undefined;
  }
  return `/repos/${match[1]}/${match[2]}/knowledge-graph`;
}

/**
 * The job id in a `/jobs/<jobId>` pathname. The job page is a static shell, so
 * the id comes from the browser path, never from route params.
 */
export function jobIdFromPathname(pathname: string | null | undefined): string | undefined {
  const match = pathname?.match(/^\/jobs\/([^/]+)\/?$/u);
  if (match === null || match === undefined) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}
