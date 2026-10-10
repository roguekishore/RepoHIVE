package com.repohive.model;

/** The pre-check CLI's one JSON line. */
public sealed interface PrecheckResult {

    record Accepted(String repo, String commitSha, String tier, String snapshotId, long javaFiles, long javaBytes, boolean truncated)
            implements PrecheckResult {}

    /** reason is the CLI's kebab-case reason, e.g. "not-found". */
    record Rejected(String reason, String message) implements PrecheckResult {

        /** NOT_FOUND from not-found. */
        public String code() {
            return reason.toUpperCase(java.util.Locale.ROOT).replace('-', '_');
        }
    }
}
