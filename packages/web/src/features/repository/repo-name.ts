/**
 * The repository named in a page URL.
 * Pure and client-safe, so the middleware, the layout and the hooks share it.
 */

/** GitHub's allowed characters for an owner and a repository name. */
const OWNER_PATTERN = /^[A-Za-z0-9-]{1,39}$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const SNAPSHOT_ID_PATTERN = /^[0-9a-f]{32}$/;

export type RepoParams =
  | { kind: "ok"; owner: string; repo: string; repoId: string }
  | { kind: "invalid" };

/** Validates URL segments; `repoId` is the lowercase `<owner>/<repo>` the app keys everything by. */
export function parseRepoParams(owner: string, repo: string): RepoParams {
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo) || repo === "." || repo === "..") {
    return { kind: "invalid" };
  }
  const lowerOwner = owner.toLowerCase();
  const lowerRepo = repo.toLowerCase();
  return { kind: "ok", owner: lowerOwner, repo: lowerRepo, repoId: `${lowerOwner}/${lowerRepo}` };
}

/** True when either segment has an uppercase letter, so the URL is not canonical. */
export function needsLowercase(owner: string, repo: string): boolean {
  return owner !== owner.toLowerCase() || repo !== repo.toLowerCase();
}

/** `?snapshot=` is used only when it is 32 lowercase hex characters. */
export function parseSnapshotParam(value: string | null | undefined): string | undefined {
  return value !== null && value !== undefined && SNAPSHOT_ID_PATTERN.test(value) ? value : undefined;
}

/** The repo id (`<owner>/<repo>`) in a `/repos/...` pathname, or `undefined` outside the repo routes. */
export function repoIdFromPathname(pathname: string | null | undefined): string | undefined {
  const match = pathname?.match(/^\/repos\/([^/]+)\/([^/]+)/);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/** The `/r/...` path of a repository's latest-snapshot pointer. */
export function latestPointerPath(repoId: string): string {
  return `/r/github.com/${repoId}/latest.json`;
}
