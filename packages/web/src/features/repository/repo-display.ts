/** Converts a ledger `repo` value to the viewer id `<owner>/<repo>`. */
export function repoKeyToRepoId(repoKey: string): string {
  const prefix = "github.com/";
  return repoKey.startsWith(prefix) ? repoKey.slice(prefix.length) : repoKey;
}

/** Link target for a repository's default surface. */
export function repoIdToKnowledgeGraphPath(repoId: string): string {
  return `/repos/${repoId}/knowledge-graph`;
}

export function shortCommitSha(commitSha: string): string {
  return commitSha.length >= 7 ? commitSha.slice(0, 7) : commitSha;
}
