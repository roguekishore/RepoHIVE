package com.repohive.model;

/** One row of indexed_repositories; repo is the repo key (github.com/owner/repo). */
public record IndexedRepo(
        String repo, String snapshotId, String commitSha, int nodeCount, int edgeCount, String indexedAt) {

    /** owner/repo: the key without the host. */
    public String repoId() {
        return repo.startsWith("github.com/") ? repo.substring("github.com/".length()) : repo;
    }
}
