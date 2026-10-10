package com.repohive.dispatch;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.model.ExecutionStatus;
import com.repohive.model.JobInput;
import software.amazon.awssdk.services.sfn.SfnClient;
import software.amazon.awssdk.services.sfn.model.DescribeExecutionRequest;
import software.amazon.awssdk.services.sfn.model.ExecutionDoesNotExistException;
import software.amazon.awssdk.services.sfn.model.StartExecutionRequest;

/** AWS Step Functions: one execution per run, named by the caller; the reference is the execution ARN. */
public class SfnDispatchService implements DispatchService {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final SfnClient client;
    private final String stateMachineArn;

    public SfnDispatchService(SfnClient client, String stateMachineArn) {
        this.client = client;
        this.stateMachineArn = stateMachineArn;
    }

    @Override
    public String start(JobInput input, String executionName) {
        String json;
        try {
            json = JSON.writeValueAsString(input);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
        return client.startExecution(StartExecutionRequest.builder()
                        .stateMachineArn(stateMachineArn)
                        .name(executionName)
                        .input(json)
                        .build())
                .executionArn();
    }

    @Override
    public ExecutionStatus describe(String executionRef) {
        String status;
        try {
            status = client.describeExecution(DescribeExecutionRequest.builder().executionArn(executionRef).build()).statusAsString();
        } catch (ExecutionDoesNotExistException e) {
            return ExecutionStatus.UNKNOWN;
        }
        if (status == null) {
            return ExecutionStatus.UNKNOWN;
        }
        return switch (status) {
            case "RUNNING", "PENDING_REDRIVE" -> ExecutionStatus.RUNNING;
            case "SUCCEEDED" -> ExecutionStatus.SUCCEEDED;
            case "FAILED" -> ExecutionStatus.FAILED;
            case "TIMED_OUT" -> ExecutionStatus.TIMED_OUT;
            case "ABORTED" -> ExecutionStatus.ABORTED;
            default -> ExecutionStatus.UNKNOWN;
        };
    }
}
