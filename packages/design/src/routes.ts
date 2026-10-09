/**
 * The route map. It is the same on both hosts, so it lives here rather than in a host's shell. Every link the design
 * package draws is built by one of these, so a path changes in one place.
 */

export const REPO_VIEWS = [
  "overview",
  "knowledge-graph",
  "hierarchy",
  "decision-audit",
  "architecture",
  "flat-baseline",
  "adaptivity",
  "circles",
] as const;

export type RepoView = (typeof REPO_VIEWS)[number];

export const routes = {
  landing: "/",
  signIn: "/auth/sign-in",
  signUp: "/auth/sign-up",
  repos: "/repos",
  activity: "/activity",
  method: "/method",
  account: "/account",
  job: (jobId: string): string => `/jobs/${encodeURIComponent(jobId)}`,
  repo: (owner: string, name: string): string => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  repoView: (owner: string, name: string, view: RepoView): string =>
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${view}`,
} as const;

/** The repository a path belongs to, or `undefined` outside one. The view is the segment after the name, if any. */
export function parseRepoPath(pathname: string): { owner: string; name: string; view?: RepoView } | undefined {
  const match = /^\/repos\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (match === null) return undefined;
  const [, owner, name, view] = match;
  if (owner === undefined || name === undefined) return undefined;
  const known = REPO_VIEWS.find((candidate) => candidate === view);
  return {
    owner: decodeURIComponent(owner),
    name: decodeURIComponent(name),
    ...(known === undefined ? {} : { view: known }),
  };
}
