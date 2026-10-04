import { isTerminalJobState, type JobRecord } from "@repohive/indexer";

/** Public job view for `GET /api/jobs/<jobId>`. */
export interface PublicJobResponse {
  readonly repo: string;
  readonly state: JobRecord["state"];
  readonly progress?: JobRecord["progress"];
  readonly result?: { readonly snapshotId: string };
  readonly failure?: { readonly code: string; readonly message: string };
}

export function toPublicJob(record: JobRecord): PublicJobResponse {
  const base: PublicJobResponse = {
    repo: record.input.repo,
    state: record.state,
    ...(record.progress === undefined ? {} : { progress: record.progress }),
  };
  if (record.state === "succeeded") {
    return { ...base, result: { snapshotId: record.input.snapshotId } };
  }
  if (record.state === "failed" && record.failureCode !== undefined) {
    return {
      ...base,
      failure: {
        code: record.failureCode,
        message: record.failureCode,
      },
    };
  }
  if (isTerminalJobState(record.state) && record.state === "failed") {
    return {
      ...base,
      failure: { code: "FAILED", message: "The index failed." },
    };
  }
  return base;
}
