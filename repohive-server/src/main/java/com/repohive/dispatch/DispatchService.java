package com.repohive.dispatch;

import com.repohive.model.ExecutionStatus;
import com.repohive.model.JobInput;

/** Starts index runs and reports on them. Implementations: Step Functions (AWS) and a local child process. */
public interface DispatchService {

    /** Starts one run and returns a reference to it; throws when it could not be started. */
    String start(JobInput input, String executionName);

    ExecutionStatus describe(String executionRef);
}
