/**
 * The pre-check (hosting-2 Requirement 2): validate a repository, resolve its
 * head commit, pick its tier and detect a cache hit, before any run starts.
 * A library function: the intake calls it synchronously and the job re-runs it
 * as validation. It spends no quota and starts no job.
 */
import { engineVersion as currentEngineVersion, isSelectedSourcePath } from "@repohive/engine";
import type { ArtifactStore } from "./artifact-store.js";
import { githubHeaders, repoApiUrl, type FetchFunction } from "./github.js";
import { hostedConfigDigest } from "./hosted-options.js";
import type { Tier } from "./job-types.js";
import { isValidRepoName, latestKey, repoKey, snapshotIdOf } from "./layout.js";
import { smallestTierFor } from "./tiers.js";

/** Why a repository was turned away; the intake shows `message` to the user. */
export type PrecheckReason =
  | "invalid-repository"
  | "not-found"
  | "private"
  | "no-default-branch"
  | "empty-repository"
  | "no-java-files"
  | "too-large"
  | "github-unavailable";

export interface PrecheckRejection {
  readonly ok: false;
  readonly reason: PrecheckReason;
  readonly message: string;
}

export interface PrecheckAccepted {
  readonly ok: true;
  /** `true` when `latest.json` already names this snapshot: start no job. */
  readonly cacheHit: boolean;
  /** `github.com/<owner>/<repo>`, lowercase. */
  readonly repo: string;
  readonly commitSha: string;
  readonly tier: Tier;
  readonly snapshotId: string;
  readonly javaFiles: number;
  readonly javaBytes: number;
  /** The tree listing was cut off; the tier is XL and the fetch caps enforce the rest. */
  readonly truncated: boolean;
}

export type PrecheckResult = PrecheckAccepted | PrecheckRejection;

export interface PrecheckDeps {
  /** The server-side GitHub token, never a user's. */
  readonly token: string;
  readonly store: ArtifactStore;
  readonly viewsVersion: string;
  /** Defaults to the global `fetch`. */
  readonly fetch?: FetchFunction;
  /** Default: the engine's `engineVersion`. Injectable so a test can vary it. */
  readonly engineVersion?: string;
  /** Default: the digest of the hosted options. */
  readonly configDigest?: string;
}

const reject = (reason: PrecheckReason, message: string): PrecheckRejection => ({ ok: false, reason, message });

/**
 * Accepts `https://github.com/<owner>/<repo>` (optionally with `.git` or a
 * trailing slash) or `<owner>/<repo>`; returns the names, `repo` lowercased,
 * or `undefined`.
 */
export function parseRepositoryReference(input: string): { owner: string; repo: string } | undefined {
  const match = /^(?:https:\/\/github\.com\/)?([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(input.trim());
  const owner = match?.[1];
  const repo = match?.[2];
  if (owner === undefined || repo === undefined || !isValidRepoName(owner, repo)) {
    return undefined;
  }
  return { owner, repo: repo.toLowerCase() };
}

interface GithubOutcome<T> {
  readonly status: number;
  readonly body?: T;
}

async function getJson<T>(doFetch: FetchFunction, url: string, token: string): Promise<GithubOutcome<T> | undefined> {
  try {
    const response = await doFetch(url, { headers: githubHeaders(token) });
    if (!response.ok) {
      return { status: response.status };
    }
    return { status: response.status, body: (await response.json()) as T };
  } catch {
    return undefined;
  }
}

interface RepositoryBody {
  private?: boolean;
  archived?: boolean;
  default_branch?: string | null;
}
interface CommitBody {
  sha?: string;
}
interface TreeBody {
  tree?: { path?: string; type?: string; size?: number }[];
  truncated?: boolean;
}

const UNAVAILABLE = reject("github-unavailable", "GitHub could not be reached just now. Try again shortly.");

export async function precheck(input: string, deps: PrecheckDeps): Promise<PrecheckResult> {
  const reference = parseRepositoryReference(input);
  if (reference === undefined) {
    return reject("invalid-repository", "Enter a repository as https://github.com/<owner>/<repo> or <owner>/<repo>.");
  }
  const { owner, repo } = reference;
  const doFetch: FetchFunction = deps.fetch ?? ((url, init) => fetch(url, init));

  const repository = await getJson<RepositoryBody>(doFetch, repoApiUrl(owner, repo), deps.token);
  if (repository === undefined) {
    return UNAVAILABLE;
  }
  // GitHub answers 404 for a private repository the token cannot see, so a 404 reads as not found.
  if (repository.status === 404) {
    return reject("not-found", "That repository was not found, or it is private.");
  }
  if (repository.body === undefined) {
    return UNAVAILABLE;
  }
  if (repository.body.private === true) {
    return reject("private", "Private repositories are not supported.");
  }
  const branch = repository.body.default_branch;
  if (typeof branch !== "string" || branch === "") {
    return reject("no-default-branch", "That repository has no default branch to index.");
  }

  const commit = await getJson<CommitBody>(
    doFetch,
    repoApiUrl(owner, repo, `/commits/${encodeURIComponent(branch)}`),
    deps.token,
  );
  if (commit === undefined) {
    return UNAVAILABLE;
  }
  if (commit.status === 409 || commit.status === 404) {
    return reject("empty-repository", "That repository has no commits to index.");
  }
  const commitSha = commit.body?.sha;
  if (commitSha === undefined || !/^[0-9a-f]{40}$/.test(commitSha)) {
    return UNAVAILABLE;
  }

  const tree = await getJson<TreeBody>(
    doFetch,
    repoApiUrl(owner, repo, `/git/trees/${commitSha}?recursive=1`),
    deps.token,
  );
  if (tree?.body === undefined) {
    return UNAVAILABLE;
  }

  let javaFiles = 0;
  let javaBytes = 0;
  for (const item of tree.body.tree ?? []) {
    if (item.type === "blob" && typeof item.path === "string" && isSelectedSourcePath(item.path)) {
      javaFiles += 1;
      javaBytes += item.size ?? 0;
    }
  }

  const truncated = tree.body.truncated === true;
  let tier: Tier | undefined;
  if (truncated) {
    // The listing is incomplete, so the counts are a lower bound: XL, with the fetch caps as the check.
    tier = "XL";
  } else {
    if (javaFiles === 0) {
      return reject("no-java-files", "That repository has no Java files to index.");
    }
    tier = smallestTierFor(javaFiles, javaBytes);
    if (tier === undefined) {
      return reject("too-large", "That repository is larger than the largest size this service indexes.");
    }
  }

  const name = repoKey(owner, repo);
  const snapshotId = snapshotIdOf({
    repo: name,
    commitSha,
    engineVersion: deps.engineVersion ?? currentEngineVersion,
    viewsVersion: deps.viewsVersion,
    configDigest: deps.configDigest ?? hostedConfigDigest(),
  });

  let cacheHit = false;
  const latest = await deps.store.get(latestKey(name));
  if (latest !== undefined) {
    try {
      const pointer = JSON.parse(Buffer.from(latest.body).toString("utf8")) as { snapshotId?: unknown };
      cacheHit = pointer.snapshotId === snapshotId;
    } catch {
      cacheHit = false;
    }
  }

  return { ok: true, cacheHit, repo: name, commitSha, tier, snapshotId, javaFiles, javaBytes, truncated };
}
