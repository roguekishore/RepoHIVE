/**
 * The repository named in a page URL.
 * Pure and client-safe, so the shell and the hooks share it.
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

/** The server path that names a repository's active snapshot. */
export function repoApiPath(repoId: string): string {
  return `/api/repos/${repoId}`;
}

/** An object of one snapshot: `path` is relative to `artifacts/<owner>/<repo>/<snapshotId>/`. */
export function artifactPath(repoId: string, snapshotId: string, path: string): string {
  return `/artifacts/${repoId}/${snapshotId}/${path}`;
}

/**
 * A `/repos/...` browser path read as the shell sees it. Repository pages are
 * static shells, so the owner, repo and surface come from the path, not from
 * route params. Replaces the middleware rules (lowercase redirect, invalid name
 * 404, bare repository to the default surface).
 */
export type RepoPath =
  | { kind: "not-repo" }
  | { kind: "invalid" }
  | {
      kind: "ok";
      repoId: string;
      /** The path segments after `<owner>/<repo>`, without a trailing empty one. */
      surface: string[];
      /** The URL has uppercase letters in the owner or repo. */
      needsLowercase: boolean;
      /** `/repos/<owner>/<repo>` with no surface. */
      bare: boolean;
      /** Where to `router.replace` to (path only), when the URL is not the canonical one. */
      redirectTo?: string;
    };

export const DEFAULT_SURFACE = "knowledge-graph";

export function parseRepoPath(pathname: string | null | undefined): RepoPath {
  if (pathname === null || pathname === undefined) return { kind: "not-repo" };
  const segments = pathname.split("/");
  // ["", "repos", owner, repo, ...surface]
  if (segments[1] !== "repos" || segments.length < 4) return { kind: "not-repo" };
  let owner: string;
  let repo: string;
  try {
    owner = decodeURIComponent(segments[2] ?? "");
    repo = decodeURIComponent(segments[3] ?? "");
  } catch {
    return { kind: "invalid" };
  }
  const parsed = parseRepoParams(owner, repo);
  if (parsed.kind === "invalid") return { kind: "invalid" };

  const rest = segments.slice(4);
  const bare = rest.length === 0 || (rest.length === 1 && rest[0] === "");
  const lowercase = needsLowercase(owner, repo);
  const surface = rest.filter((segment, index) => !(index === rest.length - 1 && segment === ""));

  let redirectTo: string | undefined;
  if (bare) {
    redirectTo = `/repos/${parsed.repoId}/${DEFAULT_SURFACE}`;
  } else if (lowercase) {
    redirectTo = ["", "repos", parsed.owner, parsed.repo, ...rest].join("/");
  }
  return { kind: "ok", repoId: parsed.repoId, surface, needsLowercase: lowercase, bare, redirectTo };
}
