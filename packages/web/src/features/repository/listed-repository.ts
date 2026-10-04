/** One row of `GET /api/repos`, as the dashboard reads it. */
export interface ListedRepository {
  readonly repoKey: string;
  readonly repoId: string;
  readonly snapshotId: string;
  readonly commitSha: string;
  readonly indexedAt: string;
  readonly nodeCount: number;
}

export interface RepositoryPage {
  readonly items: readonly ListedRepository[];
  readonly page: number;
  readonly totalPages: number;
  readonly total: number;
}

/** The server's page size for `GET /api/repos`. */
export const REPOSITORIES_PAGE_SIZE = 50;

/** `?page=` as a positive integer, 1 when absent or unusable. */
export function parsePageParam(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

/** The request path for one page of the dashboard list. */
export function repositoriesPath(page: number): string {
  return `/api/repos?page=${page}`;
}

/** Reads one page of indexed repositories from the server. */
export async function fetchRepositoryPage(page: number): Promise<RepositoryPage> {
  const response = await fetch(repositoriesPath(page));
  if (!response.ok) {
    throw new Error(`Could not load the repository list (${response.status}).`);
  }
  return (await response.json()) as RepositoryPage;
}
