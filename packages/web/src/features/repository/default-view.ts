import type { RepoView } from "@repohive/design";

/**
 * The view a repository's root URL opens, and where a finished job sends the user. One constant, so the middleware's
 * 307 and the job link cannot disagree.
 *
 * It is the Overview. The Map keeps its URL, `knowledge-graph`, but is no longer the entry
 * point.
 */
export const DEFAULT_REPO_VIEW: RepoView = "overview";
