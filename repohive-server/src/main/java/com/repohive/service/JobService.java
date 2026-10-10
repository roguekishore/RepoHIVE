package com.repohive.service;

import com.repohive.dispatch.DispatchService;
import com.repohive.model.JobRow;
import com.repohive.model.JobStates;
import com.repohive.model.Tiers;
import com.repohive.repository.IndexedRepoRepository;
import com.repohive.repository.JobRepository;
import java.time.Clock;
import java.util.Optional;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The job lifecycle: dispatch (with the shared L/XL slot), worker reports, endings and refunds. A transaction is
 * never held across a call to the dispatcher.
 */
@Service
public class JobService {

    private static final Logger LOG = LoggerFactory.getLogger(JobService.class);

    /** A third retier fails the job (today: retiers < 2 allowed). */
    public static final int MAX_RETIERS = 2;

    public enum DispatchOutcome { STARTED, WAITING, START_FAILED, SKIPPED }

    public record Progress(String stage, Integer completed, Integer total) {}

    public sealed interface Completion {
        record Succeeded(String snapshotId, String commitSha, String engineVersion, String viewsVersion, int nodeCount, int edgeCount)
                implements Completion {}

        record Failed(String failureClass, String failureCode, String message) implements Completion {}

        record Retier(String tier) implements Completion {}
    }

    public enum ReportKind { OK, NOT_FOUND, NOT_OPEN, BAD_REQUEST }

    public record ReportResult(ReportKind kind, String message) {
        static final ReportResult OK = new ReportResult(ReportKind.OK, null);
        static final ReportResult NOT_FOUND = new ReportResult(ReportKind.NOT_FOUND, null);
        static final ReportResult NOT_OPEN = new ReportResult(ReportKind.NOT_OPEN, null);

        static ReportResult bad(String message) {
            return new ReportResult(ReportKind.BAD_REQUEST, message);
        }
    }

    private final JobRepository jobs;
    private final IndexedRepoRepository repos;
    private final QuotaService quota;
    private final DispatchService dispatcher;
    private final Clock clock;
    private final ApplicationEventPublisher events;
    private final TransactionTemplate tx;
    private final ReentrantLock largeSlot = new ReentrantLock();

    public JobService(
            JobRepository jobs,
            IndexedRepoRepository repos,
            QuotaService quota,
            DispatchService dispatcher,
            Clock clock,
            ApplicationEventPublisher events,
            PlatformTransactionManager txManager) {
        this.jobs = jobs;
        this.repos = repos;
        this.quota = quota;
        this.dispatcher = dispatcher;
        this.clock = clock;
        this.events = events;
        this.tx = new TransactionTemplate(txManager);
    }

    private String now() {
        return TimeFormat.iso(clock.instant());
    }

    public Optional<JobRow> find(String jobId) {
        return jobs.find(jobId);
    }

    /** `<jobId>`, `<jobId>-r<n>` after the n-th retier, `<jobId>-s` for the restart. */
    static String executionName(JobRow job) {
        return job.retierCount() == 0 ? job.id() : job.id() + "-r" + job.retierCount();
    }

    // ---- dispatch ---------------------------------------------------------------------------------------------

    /**
     * Starts a QUEUED job now, or leaves an L/XL job waiting for the slot (state waiting-for-slot). A start that
     * fails ends the job as a system failure and refunds it.
     */
    public DispatchOutcome dispatch(String jobId) {
        Optional<JobRow> found = jobs.find(jobId);
        if (found.isEmpty() || !JobRow.QUEUED.equals(found.get().status())) {
            return DispatchOutcome.SKIPPED;
        }
        if (!Tiers.isLarge(found.get().tier())) {
            return start(found.get());
        }
        largeSlot.lock();
        try {
            JobRow job = jobs.find(jobId).orElse(null);
            if (job == null || !JobRow.QUEUED.equals(job.status())) {
                return DispatchOutcome.SKIPPED;
            }
            if (jobs.countRunningLarge() > 0 || jobs.hasOlderQueuedLarge(job.createdAt(), job.id())) {
                tx.executeWithoutResult(s -> jobs.markWaiting(job.id(), now()));
                return DispatchOutcome.WAITING;
            }
            return start(job);
        } finally {
            largeSlot.unlock();
        }
    }

    private DispatchOutcome start(JobRow job) {
        String ref;
        try {
            ref = dispatcher.start(job.input(), executionName(job));
        } catch (RuntimeException e) {
            LOG.error("could not start job {}", job.id(), e);
            failJob(job.id(), JobRow.QUEUED, null, "ORCHESTRATOR_START_FAILED", "The index could not be started.");
            return DispatchOutcome.START_FAILED;
        }
        tx.executeWithoutResult(s -> jobs.markRunning(job.id(), job.retierCount(), ref, now()));
        return DispatchOutcome.STARTED;
    }

    /** The one restart of a run that ended before its worker started. False when the job moved on meanwhile. */
    public boolean restart(JobRow job) {
        String ref = dispatcher.start(job.input(), job.id() + "-s");
        Boolean updated = tx.execute(s -> jobs.markRestarted(job.id(), job.executionRef(), ref, now()));
        return Boolean.TRUE.equals(updated);
    }

    // ---- endings ----------------------------------------------------------------------------------------------

    /**
     * Ends a job as a system failure and refunds it, if it is still in the expected status (and execution, when
     * given). One transaction. True when this call ended it.
     */
    public boolean failJob(String jobId, String expectedStatus, String expectedRef, String code, String message) {
        Boolean ended = tx.execute(s -> {
            boolean changed = jobs.end(jobId, expectedStatus, expectedRef, JobRow.FAILED, "failed", "system", code, message, now());
            if (changed) {
                quota.refund(jobId);
            }
            return changed;
        });
        if (Boolean.TRUE.equals(ended)) {
            events.publishEvent(new JobEnded(jobId));
            return true;
        }
        return false;
    }

    // ---- worker reports ---------------------------------------------------------------------------------------

    /** A state (applied only when it moves forward) and/or new progress; either may be null. */
    public ReportResult progress(String jobId, String state, Progress progress) {
        return tx.execute(s -> {
            Optional<JobRow> found = jobs.find(jobId);
            if (found.isEmpty()) {
                return ReportResult.NOT_FOUND;
            }
            JobRow job = found.get();
            if (job.terminal()) {
                return ReportResult.NOT_OPEN;
            }
            String next = state != null && JobStates.isForward(job.state(), state) ? state : job.state();
            jobs.updateProgress(jobId, next, progress != null,
                    progress == null ? null : progress.stage(),
                    progress == null ? null : progress.completed(),
                    progress == null ? null : progress.total(), now());
            return ReportResult.OK;
        });
    }

    /** The worker's one outcome. */
    public ReportResult complete(String jobId, Completion completion) {
        boolean[] ended = {false};
        boolean[] requeued = {false};
        ReportResult result = tx.execute(s -> {
            Optional<JobRow> found = jobs.find(jobId);
            if (found.isEmpty()) {
                return ReportResult.NOT_FOUND;
            }
            JobRow job = found.get();
            if (job.terminal()) {
                return ReportResult.NOT_OPEN;
            }
            String now = now();
            switch (completion) {
                case Completion.Succeeded done -> {
                    if (!done.snapshotId().equals(job.snapshotId())) {
                        return ReportResult.bad("snapshotId does not match the job.");
                    }
                    jobs.end(jobId, job.status(), null, JobRow.SUCCEEDED, "succeeded", null, null, null, now);
                    repos.upsert(job.repo(), job.snapshotId(), done.commitSha() == null ? job.commitSha() : done.commitSha(),
                            done.engineVersion(), done.viewsVersion(), done.nodeCount(), done.edgeCount(), now, jobId);
                    ended[0] = true;
                }
                case Completion.Failed failed -> {
                    jobs.end(jobId, job.status(), null, JobRow.FAILED, "failed", failed.failureClass(), failed.failureCode(),
                            failed.message(), now);
                    if ("system".equals(failed.failureClass())) {
                        quota.refund(jobId);
                    }
                    ended[0] = true;
                }
                case Completion.Retier retier -> {
                    if (!Tiers.isLarger(retier.tier(), job.tier())) {
                        return ReportResult.bad("tier must be larger than the job's tier.");
                    }
                    if (job.retierCount() < MAX_RETIERS) {
                        jobs.requeueRetier(jobId, retier.tier(), job.retierCount() + 1, now);
                        requeued[0] = true;
                    } else {
                        jobs.end(jobId, job.status(), null, JobRow.FAILED, "failed", "system", "retier-limit",
                                "The repository needed a larger tier too many times.", now);
                        quota.refund(jobId);
                        ended[0] = true;
                    }
                }
            }
            return ReportResult.OK;
        });
        if (result != null && result.kind() == ReportKind.OK) {
            if (requeued[0]) {
                dispatch(jobId);
            }
            if (ended[0] || requeued[0]) {
                events.publishEvent(new JobEnded(jobId));
            }
        }
        return result;
    }
}
