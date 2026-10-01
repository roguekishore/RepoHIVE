/**
 * What every GitHub call shares (hosting-2 Requirements 2 and 4): the headers,
 * the injectable `fetch`, and the one place a URL is built from validated parts.
 */
import { isValidRepoName } from "./layout.js";

export type FetchFunction = (url: string, init?: RequestInit) => Promise<Response>;

const GITHUB_API = "https://api.github.com";
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * `https://api.github.com/repos/<owner>/<repo><suffix>`. Throws on an owner or
 * repo that fails validation: no user string reaches the URL unchecked (4.1).
 */
export function repoApiUrl(owner: string, repo: string, suffix = ""): string {
  if (!isValidRepoName(owner, repo)) {
    throw new RangeError(`not a valid GitHub repository name: ${JSON.stringify(`${owner}/${repo}`)}`);
  }
  return `${GITHUB_API}/repos/${owner}/${repo}${suffix}`;
}

/** True for a full 40-character lowercase commit SHA. */
export function isCommitSha(value: string): boolean {
  return SHA_PATTERN.test(value);
}

/** `https://api.github.com/repos/<owner>/<repo>/tarball/<sha>`. */
export function tarballUrl(owner: string, repo: string, commitSha: string): string {
  if (!isCommitSha(commitSha)) {
    throw new RangeError(`not a commit SHA: ${JSON.stringify(commitSha)}`);
  }
  return repoApiUrl(owner, repo, `/tarball/${commitSha}`);
}
