import type { RepoResponse } from "@/lib/api/types";

/**
 * The repository summary the navigation shows for a repository named in the
 * URL. The app no longer asks a server for a repository list to draw the
 * sidebar: the repository in the path is the one the visitor is looking at
 * (hosting-3 Requirement 2.5 removed the registry and `/api/repos`).
 */
export function repoSummaryFor(repoId: string): RepoResponse {
  return {
    id: repoId,
    name: repoId,
    url: "",
    local_path: "",
    default_branch: "main",
    head_commit: null,
    settings: {},
    created_at: "",
    updated_at: "",
    workspace_status: "indexed",
    docs_mode: "none",
  };
}

/** `repos` with the URL's repository added when it is not already listed. */
export function withActiveRepo(repos: RepoResponse[], activeRepoId: string | undefined): RepoResponse[] {
  if (activeRepoId === undefined || repos.some((repo) => repo.id === activeRepoId)) return repos;
  return [...repos, repoSummaryFor(activeRepoId)];
}
