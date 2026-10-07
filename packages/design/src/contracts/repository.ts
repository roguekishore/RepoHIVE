/** One indexed repository in the list. Both hosts serve exactly these fields. */
export interface RepositoryListItem {
  readonly repoKey: string;
  readonly repoId: string;
  readonly snapshotId: string;
  readonly commitSha: string;
  /** ISO-8601 UTC. */
  readonly indexedAt: string;
  readonly nodeCount: number;
}

/** A page of the list: `page` is 1-based. */
export interface RepositoryPage {
  readonly items: readonly RepositoryListItem[];
  readonly page: number;
  readonly totalPages: number;
  readonly total: number;
}

/**
 * `GET /api/repos/<owner>/<repo>`: the facts a repository header shows. `edgeCount` is optional because a host that
 * did not record it leaves it out; a screen hides the figure when it is absent.
 */
export interface RepositorySummary {
  readonly repo: string;
  readonly snapshotId: string;
  readonly commitSha: string;
  readonly nodeCount: number;
  readonly edgeCount?: number;
  /** ISO-8601 UTC. */
  readonly indexedAt: string;
}

/** Which repository a page is about. */
export interface RepositoryRef {
  readonly owner: string;
  readonly name: string;
}
