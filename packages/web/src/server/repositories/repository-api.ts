/**
 * The repository resources of the contract (`GET /api/repos`, `GET /api/repos/<owner>/<repo>`), mapped from the list
 * the dashboard already reads. The shapes mirror the Java server's `RepoController`, so one browser client serves both
 * hosts. Only recorded values are returned.
 */
import type { RepositoryPage, RepositorySummary } from "@repohive/design/contracts";
import { parseRepoParams } from "@/features/repository/repo-name";
import {
  paginateRepositories,
  type ListedRepository,
} from "./list-indexed-repositories";

/**
 * `?page=` as the Java server reads it: anything that is not a number, or is below 1, is page 1, and a fraction rounds
 * down. The pagination itself clamps a page past the end.
 */
export function parsePageParam(text: string | null): number {
  if (text === null) return 1;
  const value = Number(text.trim());
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

export function toRepositoryPage(all: readonly ListedRepository[], pageText: string | null): RepositoryPage {
  return paginateRepositories(all, parsePageParam(pageText));
}

/** The repository named in a URL, or `undefined` when the name is not GitHub-valid or nothing is indexed under it. */
export function findListedRepository(
  all: readonly ListedRepository[],
  owner: string,
  name: string,
): ListedRepository | undefined {
  const parsed = parseRepoParams(owner, name);
  if (parsed.kind === "invalid") return undefined;
  return all.find((item) => item.repoId.toLowerCase() === parsed.repoId);
}

/** `edgeCount` is left out: TS records no edge count anywhere, and the contract field is optional. */
export function toRepositorySummary(item: ListedRepository): RepositorySummary {
  return {
    repo: item.repoId.toLowerCase(),
    snapshotId: item.snapshotId,
    commitSha: item.commitSha,
    nodeCount: item.nodeCount,
    indexedAt: item.indexedAt,
  };
}
