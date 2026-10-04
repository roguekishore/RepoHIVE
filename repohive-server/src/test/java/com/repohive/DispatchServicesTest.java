package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.dispatch.LocalDispatchService;
import com.repohive.dispatch.SfnDispatchService;
import com.repohive.model.ExecutionStatus;
import com.repohive.model.JobInput;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import software.amazon.awssdk.services.sfn.SfnClient;
import software.amazon.awssdk.services.sfn.model.DescribeExecutionRequest;
import software.amazon.awssdk.services.sfn.model.DescribeExecutionResponse;
import software.amazon.awssdk.services.sfn.model.ExecutionDoesNotExistException;
import software.amazon.awssdk.services.sfn.model.StartExecutionRequest;
import software.amazon.awssdk.services.sfn.model.StartExecutionResponse;

class DispatchServicesTest {

    static final String ARN = "arn:aws:states:ap-south-1:123456789012:stateMachine:x";
    static final JobInput INPUT = JobInput.publicJob("job1", "acct", "github.com/acme/widgets", "c0ffee", "S", "5".repeat(32));

    @Test
    void jobInputJsonHasTheContractKeyOrder() throws Exception {
        assertThat(new ObjectMapper().writeValueAsString(INPUT)).isEqualTo(
                "{\"jobId\":\"job1\",\"accountId\":\"acct\",\"repo\":\"github.com/acme/widgets\",\"commitSha\":\"c0ffee\",\"tier\":\"S\",\"snapshotId\":\""
                        + "5".repeat(32) + "\",\"visibility\":\"public\"}");
    }

    @Test
    void sfnStartsAnExecutionNamedAfterTheRunWithTheInputJson() throws Exception {
        SfnClient client = mock(SfnClient.class);
        when(client.startExecution(any(StartExecutionRequest.class)))
                .thenReturn(StartExecutionResponse.builder().executionArn(ARN.replace("stateMachine", "execution") + ":job1-r1").build());
        String ref = new SfnDispatchService(client, ARN).start(INPUT, "job1-r1");
        ArgumentCaptor<StartExecutionRequest> captor = ArgumentCaptor.forClass(StartExecutionRequest.class);
        org.mockito.Mockito.verify(client).startExecution(captor.capture());
        assertThat(captor.getValue().stateMachineArn()).isEqualTo(ARN);
        assertThat(captor.getValue().name()).isEqualTo("job1-r1");
        assertThat(captor.getValue().input()).isEqualTo(new ObjectMapper().writeValueAsString(INPUT));
        assertThat(ref).endsWith("execution:x:job1-r1");
    }

    @Test
    void sfnStartFailuresPropagate() {
        SfnClient client = mock(SfnClient.class);
        when(client.startExecution(any(StartExecutionRequest.class))).thenThrow(new IllegalStateException("denied"));
        assertThatThrownBy(() -> new SfnDispatchService(client, ARN).start(INPUT, "job1")).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void sfnDescribeMapsStatuses() {
        SfnClient client = mock(SfnClient.class);
        SfnDispatchService service = new SfnDispatchService(client, ARN);
        Map<String, ExecutionStatus> expected = Map.of(
                "RUNNING", ExecutionStatus.RUNNING, "PENDING_REDRIVE", ExecutionStatus.RUNNING, "SUCCEEDED", ExecutionStatus.SUCCEEDED,
                "FAILED", ExecutionStatus.FAILED, "TIMED_OUT", ExecutionStatus.TIMED_OUT, "ABORTED", ExecutionStatus.ABORTED);
        expected.forEach((raw, mapped) -> {
            when(client.describeExecution(any(DescribeExecutionRequest.class))).thenReturn(DescribeExecutionResponse.builder().status(raw).build());
            assertThat(service.describe("ref")).as(raw).isEqualTo(mapped);
        });
        when(client.describeExecution(any(DescribeExecutionRequest.class))).thenReturn(DescribeExecutionResponse.builder().status("SOMETHING_NEW").build());
        assertThat(service.describe("ref")).isEqualTo(ExecutionStatus.UNKNOWN);
        when(client.describeExecution(any(DescribeExecutionRequest.class))).thenThrow(ExecutionDoesNotExistException.builder().message("gone").build());
        assertThat(service.describe("ref")).isEqualTo(ExecutionStatus.UNKNOWN);
    }

    private static ExecutionStatus await(LocalDispatchService service, String ref) throws Exception {
        long deadline = System.currentTimeMillis() + 15_000;
        while (service.describe(ref) == ExecutionStatus.RUNNING && System.currentTimeMillis() < deadline) {
            Thread.sleep(25);
        }
        return service.describe(ref);
    }

    /** A child that stays alive until the service stops it (`sleep 30` is not portable). */
    private static final String SLEEP = "setTimeout(() => {}, 30000)";

    /** The fake child is a Node one-liner, so the tests run on Windows and Linux alike. Node is a project prerequisite. */
    private static LocalDispatchService local(Path dir, String script) {
        Map<String, String> env = new HashMap<>(System.getenv());
        env.put("REPOHIVE_LOCAL_JOB_INJECT_FAILURE", "system");
        return new LocalDispatchService(List.of("node", "-e", script), env, dir.resolve("data"), dir.resolve("store"), "http://127.0.0.1:9", "s3cret");
    }

    @Test
    void localRunsAChildWithTheEnvironmentAndLogsItsOutput(@TempDir Path dir) throws Exception {
        LocalDispatchService service = local(dir,
                "const e = process.env; console.log('input=' + e.REPOHIVE_JOB_INPUT); console.log('store=' + e.REPOHIVE_STORE);"
                        + " console.log('url=' + e.REPOHIVE_SERVER_URL); console.log('secret=' + e.REPOHIVE_INTERNAL_SECRET);"
                        + " console.log('tar=' + e.REPOHIVE_TARBALL_DIR); console.log('inject=' + e.REPOHIVE_LOCAL_JOB_INJECT_FAILURE);"
                        + " console.error('oops'); process.exitCode = 3");
        String ref = service.start(INPUT, "job1");
        assertThat(ref).isEqualTo("job1");
        assertThat(await(service, ref)).isEqualTo(ExecutionStatus.FAILED);
        String log = Files.readString(dir.resolve("data/jobs/job1.log"));
        assertThat(log).contains("input=" + new ObjectMapper().writeValueAsString(INPUT))
                .contains("store=local:" + dir.toAbsolutePath().resolve("store"))
                .contains("url=http://127.0.0.1:9").contains("secret=s3cret")
                .contains("tar=" + dir.toAbsolutePath().resolve("data/tarballs"))
                .contains("inject=system").contains("oops");
        // A second run of the same job appends.
        service.start(INPUT, "job1-r1");
        await(service, "job1-r1");
        assertThat(Files.readString(dir.resolve("data/jobs/job1.log")).split("input=", -1)).hasSize(3);
    }

    @Test
    void localDescribeFollowsTheProcess(@TempDir Path dir) throws Exception {
        LocalDispatchService ok = local(dir, "process.exitCode = 0");
        ok.start(INPUT, "ok");
        assertThat(await(ok, "ok")).isEqualTo(ExecutionStatus.SUCCEEDED);
        assertThat(ok.describe("never-started")).isEqualTo(ExecutionStatus.UNKNOWN);

        LocalDispatchService slow = local(dir, SLEEP);
        slow.start(INPUT, "slow");
        assertThat(slow.describe("slow")).isEqualTo(ExecutionStatus.RUNNING);
        slow.shutdown();
        assertThat(slow.describe("slow")).isEqualTo(ExecutionStatus.UNKNOWN);
    }

    @Test
    void localShutdownDestroysChildren(@TempDir Path dir) throws Exception {
        LocalDispatchService slow = local(dir, SLEEP);
        slow.start(INPUT, "slow");
        List<ProcessHandle> children = ProcessHandle.current().children().filter(ProcessHandle::isAlive).toList();
        assertThat(children).as("the started child").isNotEmpty();
        slow.shutdown();
        long deadline = System.currentTimeMillis() + 5000;
        while (children.stream().anyMatch(ProcessHandle::isAlive) && System.currentTimeMillis() < deadline) {
            Thread.sleep(25);
        }
        assertThat(children).noneMatch(ProcessHandle::isAlive);
    }

    @Test
    void localStartFailureThrows(@TempDir Path dir) {
        LocalDispatchService service = new LocalDispatchService(List.of("/no/such/binary"), Map.of(), dir.resolve("data"), dir.resolve("store"), "u", "s");
        assertThatThrownBy(() -> service.start(INPUT, "job1")).isInstanceOf(RuntimeException.class);
    }
}
