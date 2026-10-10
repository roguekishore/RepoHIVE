package com.repohive.model;

/** One row of job_executions. Nullable: progress*, failure*, executionRef, startedAt, endedAt. */
public record JobRow(
        String id,
        String repo,
        String commitSha,
        String snapshotId,
        String accountId,
        String tier,
        String status,
        String state,
        String progressStage,
        Integer progressCompleted,
        Integer progressTotal,
        String failureClass,
        String failureCode,
        String failureMessage,
        int retierCount,
        int restarted,
        String executionRef,
        String createdAt,
        String queuedAt,
        String startedAt,
        String updatedAt,
        String endedAt) {

    public static final String QUEUED = "QUEUED";
    public static final String RUNNING = "RUNNING";
    public static final String SUCCEEDED = "SUCCEEDED";
    public static final String FAILED = "FAILED";

    public boolean terminal() {
        return SUCCEEDED.equals(status) || FAILED.equals(status);
    }

    public JobInput input() {
        return JobInput.publicJob(id, accountId, repo, commitSha, tier, snapshotId);
    }
}
