package com.repohive.model;

/** What a dispatcher can say about an execution it started. UNKNOWN: it cannot tell. */
public enum ExecutionStatus {
    RUNNING,
    SUCCEEDED,
    FAILED,
    TIMED_OUT,
    ABORTED,
    UNKNOWN
}
