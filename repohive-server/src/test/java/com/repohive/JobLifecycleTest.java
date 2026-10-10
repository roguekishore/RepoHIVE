package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.model.ExecutionStatus;
import com.repohive.service.JobReconciliationService;
import com.repohive.service.JobService;
import com.repohive.service.SlotDispatcher;
import com.repohive.support.Seed;
import java.time.Duration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** The slot and the reconciler, driven directly with a settable clock and a fake dispatcher. */
class JobLifecycleTest extends JobTestBase {

    @Autowired JobService jobs;
    @Autowired SlotDispatcher slots;
    @Autowired JobReconciliationService reconciler;

    String account;

    @BeforeEach
    void account() {
        account = Seed.account(jdbc);
    }

    private String queued(String repo, String tier) {
        String id = Seed.job(jdbc, clock.instant(), account, repo, tier);
        clock.advance(Duration.ofSeconds(1));
        return id;
    }

    private String dispatched(String repo, String tier) {
        String id = queued(repo, tier);
        jobs.dispatch(id);
        return id;
    }

    private void fail(String id) {
        jobs.complete(id, new JobService.Completion.Failed("user", "X", "m"));
    }

    // ---- slot ------------------------------------------------------------------------------------------------

    @Test
    void smallJobsStartAtOnceAndKeepTheirState() {
        String id = dispatched("github.com/a/s", "S");
        assertThat(jobColumn(id, "status")).isEqualTo("RUNNING");
        assertThat(jobColumn(id, "state")).isEqualTo("queued");
        assertThat(jobColumn(id, "execution_ref")).isEqualTo("ref:" + id);
        assertThat(jobColumn(id, "started_at")).isNotNull();
        String m = dispatched("github.com/a/m", "M");
        assertThat(jobColumn(m, "status")).isEqualTo("RUNNING");
    }

    @Test
    void aSecondLargeJobWaitsAndStartsWhenTheFirstEnds() {
        String first = dispatched("github.com/a/one", "L");
        String second = dispatched("github.com/a/two", "XL");
        assertThat(jobColumn(first, "status")).isEqualTo("RUNNING");
        assertThat(jobColumn(second, "status")).isEqualTo("QUEUED");
        assertThat(jobColumn(second, "state")).isEqualTo("waiting-for-slot");
        assertThat(dispatch.started).hasSize(1);

        // Small jobs are not held up by the large slot.
        assertThat(jobColumn(dispatched("github.com/a/small", "S"), "status")).isEqualTo("RUNNING");

        fail(first);
        assertThat(jobColumn(second, "status")).isEqualTo("RUNNING");
        assertThat(jobColumn(second, "execution_ref")).isEqualTo("ref:" + second);
        assertThat(dispatch.started.get(dispatch.started.size() - 1).name()).isEqualTo(second);
    }

    @Test
    void waitingLargeJobsStartInCreatedAtOrder() {
        String first = dispatched("github.com/a/one", "L");
        String older = queued("github.com/a/older", "L");
        String newer = queued("github.com/a/newer", "L");
        // The newer one asks first; it still waits behind the older one.
        assertThat(jobs.dispatch(newer)).isEqualTo(JobService.DispatchOutcome.WAITING);
        assertThat(jobs.dispatch(older)).isEqualTo(JobService.DispatchOutcome.WAITING);

        fail(first);
        assertThat(jobColumn(older, "status")).isEqualTo("RUNNING");
        assertThat(jobColumn(newer, "status")).isEqualTo("QUEUED");
        fail(older);
        assertThat(jobColumn(newer, "status")).isEqualTo("RUNNING");
    }

    @Test
    void theTickStartsAWaitingJobWhenTheSlotFreedWithoutAnEvent() {
        String first = dispatched("github.com/a/one", "L");
        String second = dispatched("github.com/a/two", "L");
        jdbc.update("UPDATE job_executions SET status = 'SUCCEEDED', state = 'succeeded' WHERE id = ?", first);
        assertThat(jobColumn(second, "status")).isEqualTo("QUEUED");
        slots.run();
        assertThat(jobColumn(second, "status")).isEqualTo("RUNNING");
    }

    @Test
    void aFailedStartFreesTheQueueAndRefunds() {
        String id = queued("github.com/a/x", "S");
        dispatch.failStart = true;
        assertThat(jobs.dispatch(id)).isEqualTo(JobService.DispatchOutcome.START_FAILED);
        assertThat(jobColumn(id, "failure_code")).isEqualTo("ORCHESTRATOR_START_FAILED");
        assertThat(refunded(id)).isEqualTo(1);
    }

    // ---- reconciliation --------------------------------------------------------------------------------------

    private void ended(String id, ExecutionStatus status) {
        dispatch.statuses.put(jobColumn(id, "execution_ref"), status);
    }

    private void reconcileAfterGrace() {
        reconciler.reconcile();
        clock.advance(Duration.ofSeconds(11));
        reconciler.reconcile();
    }

    @Test
    void aRunThatNeverStartedIsRestartedOnceThenFailsAsNotStarted() {
        String id = dispatched("github.com/a/r", "S");
        ended(id, ExecutionStatus.FAILED);
        reconciler.reconcile();
        assertThat(jobColumn(id, "restarted")).isEqualTo("0");
        clock.advance(Duration.ofSeconds(11));
        reconciler.reconcile();
        assertThat(jobColumn(id, "status")).isEqualTo("RUNNING");
        assertThat(jobColumn(id, "restarted")).isEqualTo("1");
        assertThat(jobColumn(id, "execution_ref")).isEqualTo("ref:" + id + "-s");
        assertThat(dispatch.started.get(1).name()).isEqualTo(id + "-s");

        ended(id, ExecutionStatus.FAILED);
        reconcileAfterGrace();
        assertThat(jobColumn(id, "status")).isEqualTo("FAILED");
        assertThat(jobColumn(id, "state")).isEqualTo("failed");
        assertThat(jobColumn(id, "failure_class")).isEqualTo("system");
        assertThat(jobColumn(id, "failure_code")).isEqualTo("runtime-not-started");
        assertThat(refunded(id)).isEqualTo(1);
    }

    @Test
    void aTimedOutExecutionFailsAsRuntimeTimeout() {
        String id = dispatched("github.com/a/t", "S");
        jobs.progress(id, "parsing", null);
        ended(id, ExecutionStatus.TIMED_OUT);
        reconcileAfterGrace();
        assertThat(jobColumn(id, "failure_code")).isEqualTo("runtime-timeout");
        assertThat(jobColumn(id, "failure_class")).isEqualTo("system");
        assertThat(refunded(id)).isEqualTo(1);
    }

    @Test
    void anyOtherEndWithoutACompletionIsRuntimeError() {
        for (ExecutionStatus status : new ExecutionStatus[] {ExecutionStatus.FAILED, ExecutionStatus.ABORTED, ExecutionStatus.SUCCEEDED}) {
            String id = dispatched("github.com/a/e" + status, "S");
            jobs.progress(id, "grouping", null);
            ended(id, status);
            reconcileAfterGrace();
            assertThat(jobColumn(id, "failure_code")).as(status.name()).isEqualTo("runtime-error");
            assertThat(refunded(id)).isEqualTo(1);
        }
    }

    @Test
    void aWorkerThatFinishesWithinTheGraceIsNotOvertaken() {
        String id = dispatched("github.com/a/race", "S");
        jobs.progress(id, "publishing", null);
        ended(id, ExecutionStatus.SUCCEEDED);
        reconciler.reconcile();
        jobs.complete(id, new JobService.Completion.Succeeded(SNAPSHOT, null, "e", "v", 3, 4));
        clock.advance(Duration.ofSeconds(11));
        reconciler.reconcile();
        assertThat(jobColumn(id, "status")).isEqualTo("SUCCEEDED");
        assertThat(refunded(id)).isZero();
    }

    @Test
    void aRunningExecutionIsLeftAlone() {
        String id = dispatched("github.com/a/ok", "S");
        clock.advance(Duration.ofMinutes(2));
        reconciler.reconcile();
        assertThat(jobColumn(id, "status")).isEqualTo("RUNNING");
    }

    @Test
    void theTierBackstopFailsEvenWhenTheDispatcherCannotTell() {
        String small = dispatched("github.com/a/small", "S");
        String unknown = dispatched("github.com/a/unknown", "M");
        ended(unknown, ExecutionStatus.UNKNOWN);
        String large = dispatched("github.com/a/large", "L");
        clock.advance(Duration.ofSeconds(625));
        reconciler.reconcile();
        assertThat(jobColumn(small, "status")).isEqualTo("RUNNING");
        assertThat(jobColumn(unknown, "status")).isEqualTo("RUNNING");
        clock.advance(Duration.ofSeconds(5));
        reconciler.reconcile();
        for (String id : new String[] {small, unknown}) {
            assertThat(jobColumn(id, "status")).isEqualTo("FAILED");
            assertThat(jobColumn(id, "failure_code")).isEqualTo("runtime-timeout");
            assertThat(jobColumn(id, "failure_class")).isEqualTo("system");
            assertThat(refunded(id)).isEqualTo(1);
        }
        assertThat(jobColumn(large, "status")).isEqualTo("RUNNING");
        clock.advance(Duration.ofSeconds(440));
        reconciler.reconcile();
        assertThat(jobColumn(large, "status")).isEqualTo("RUNNING");
        clock.advance(Duration.ofSeconds(20));
        reconciler.reconcile();
        assertThat(jobColumn(large, "failure_code")).isEqualTo("runtime-timeout");
    }

    @Test
    void aLargeJobWaitingMoreThanTwentyMinutesFails() {
        String first = dispatched("github.com/a/one", "L");
        String waiting = dispatched("github.com/a/two", "XL");
        // Keep the running one inside its backstop so the slot stays taken.
        clock.advance(Duration.ofMinutes(19));
        jdbc.update("UPDATE job_executions SET started_at = ? WHERE id = ?", "2026-10-03T12:19:00.000Z", first);
        reconciler.reconcile();
        assertThat(jobColumn(waiting, "status")).isEqualTo("QUEUED");
        clock.advance(Duration.ofMinutes(2));
        jdbc.update("UPDATE job_executions SET started_at = ? WHERE id = ?", "2026-10-03T12:21:00.000Z", first);
        reconciler.reconcile();
        assertThat(jobColumn(waiting, "status")).isEqualTo("FAILED");
        assertThat(jobColumn(waiting, "failure_code")).isEqualTo("slot-wait-timeout");
        assertThat(jobColumn(waiting, "failure_class")).isEqualTo("system");
        assertThat(refunded(waiting)).isEqualTo(1);
        assertThat(jobColumn(first, "status")).isEqualTo("RUNNING");
    }
}
