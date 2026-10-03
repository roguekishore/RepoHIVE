import { apiGet, apiPost } from "./client";
import type {
  RepoCreate,
  RepoResponse,
  PreflightResponse,
} from "./types";

export async function listRepos(): Promise<RepoResponse[]> {
  return apiGet<RepoResponse[]>("/api/repos");
}

export async function getRepo(repoId: string): Promise<RepoResponse> {
  return apiGet<RepoResponse>(`/api/repos/${repoId}`);
}

export async function createRepo(data: RepoCreate): Promise<RepoResponse> {
  return apiPost<RepoResponse>("/api/repos", data);
}

/** Start the first full index (docs included) for a registered repo.
 * Returns 409 when a job is already active for it. */
export async function startIndexJob(
  repoId: string,
): Promise<{ job_id: string; status: string }> {
  return apiPost<{ job_id: string; status: string }>(`/api/repos/${repoId}/index`);
}

/** Provider connectivity smoke test + page/cost estimate for a first index. */
export async function preflightIndex(
  repoId: string,
  coveragePct?: number,
): Promise<PreflightResponse> {
  return apiPost<PreflightResponse>(
    `/api/repos/${repoId}/preflight`,
    undefined,
    undefined,
    coveragePct !== undefined ? { coverage_pct: coveragePct } : undefined,
  );
}
