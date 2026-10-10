package com.repohive.model;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;

/** What the dispatcher hands the worker: the key order is part of the contract with the indexer. */
@JsonPropertyOrder({"jobId", "accountId", "repo", "commitSha", "tier", "snapshotId", "visibility"})
public record JobInput(
        String jobId, String accountId, String repo, String commitSha, String tier, String snapshotId, String visibility) {

    public static JobInput publicJob(String jobId, String accountId, String repo, String commitSha, String tier, String snapshotId) {
        return new JobInput(jobId, accountId, repo, commitSha, tier, snapshotId, "public");
    }
}
