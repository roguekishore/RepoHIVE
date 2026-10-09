import type { RepoView } from "@repohive/design";

/**
 * The view a repository's root URL opens, and where a finished job sends the user. One constant, so the middleware's
 * 307 and the job link cannot disagree.
 *
 * The plan (own-identity, C1) makes this `overview`. It stays `knowledge-graph` until the Overview screen exists:
 * redirecting to a page that is not built yet would 404 every repository root. Flip it in the commit that adds the
 * Overview page.
 */
export const DEFAULT_REPO_VIEW: RepoView = "knowledge-graph";
