import type { FilesIndexResponse } from "@repohive/types/files";
import { apiGet } from "./client";

/** Slim per-file rows for the browsable Files index + treemap. */
export async function getFilesIndex(repoId: string): Promise<FilesIndexResponse> {
  return apiGet<FilesIndexResponse>(`/api/repos/${repoId}/files`);
}
