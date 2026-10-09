/**
 * Provider management API module.
 */

import { apiGet } from "./client";
import type { ProvidersResponse } from "./types";

export async function getProviders(
  repoId?: string,
): Promise<ProvidersResponse> {
  const qs = repoId ? `?repo_id=${encodeURIComponent(repoId)}` : "";
  return apiGet<ProvidersResponse>(`/api/providers${qs}`);
}
