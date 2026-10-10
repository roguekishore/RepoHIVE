package com.repohive.service;

import com.repohive.dispatch.DispatchService;
import com.repohive.model.ExecutionStatus;
import com.repohive.model.JobRow;
import com.repohive.model.Tiers;
import com.repohive.repository.JobRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Fails and refunds jobs whose run ended without the worker's completion call, jobs past their tier's backstop,
 * and L/XL jobs that waited too long for the slot. Dispatcher calls happen outside any transaction; each fix is
 * its own transaction in {@link JobService}.
 */
@Service
public class JobReconciliationService {

    private static final Logger LOG = LoggerFactory.getLogger(JobReconciliationService.class);

    static final Duration BACKSTOP_EXTRA = Duration.ofMinutes(5);
    static final Duration SLOT_WAIT_LIMIT = Duration.ofMinutes(20);

    private final JobRepository jobs;
    private final JobService jobService;
    private final DispatchService dispatcher;
    private final Clock clock;
    private final Duration grace;
    /** When each ended execution (by reference) was first seen ended. */
    private final Map<String, Instant> endedSince = new HashMap<>();

    public JobReconciliationService(
            JobRepository jobs,
            JobService jobService,
            DispatchService dispatcher,
            Clock clock,
            @Value("${repohive.reconcile.grace-ms:10000}") long graceMs) {
        this.jobs = jobs;
        this.jobService = jobService;
        this.dispatcher = dispatcher;
        this.clock = clock;
        this.grace = Duration.ofMillis(graceMs);
    }

    @Scheduled(
            initialDelayString = "${repohive.reconcile.initial-delay-ms:30000}",
            fixedDelayString = "${repohive.reconcile.interval-ms:30000}")
    public synchronized void reconcile() {
        Instant now = clock.instant();
        try {
            List<JobRow> running = jobs.running();
            endedSince.keySet().retainAll(running.stream().map(JobRow::executionRef).toList());
            for (JobRow job : running) {
                try {
                    reconcileRunning(job, now);
                } catch (RuntimeException e) {
                    LOG.error("could not reconcile job {}", job.id(), e);
                }
            }
            String cutoff = TimeFormat.iso(now.minus(SLOT_WAIT_LIMIT));
            for (JobRow job : jobs.queuedLargeBefore(cutoff)) {
                jobService.failJob(job.id(), JobRow.QUEUED, null, "slot-wait-timeout", "The index waited too long for a free slot.");
            }
        } catch (RuntimeException e) {
            LOG.error("reconciliation failed", e);
        }
    }

    private void reconcileRunning(JobRow job, Instant now) {
        if (job.startedAt() != null) {
            Duration backstop = Duration.ofSeconds(Tiers.timeoutSeconds(job.tier())).plus(BACKSTOP_EXTRA);
            if (now.isAfter(TimeFormat.parseIso(job.startedAt()).plus(backstop))) {
                jobService.failJob(job.id(), JobRow.RUNNING, job.executionRef(), "runtime-timeout", "The index ran past its time limit.");
                return;
            }
        }
        String ref = job.executionRef();
        if (ref == null) {
            return;
        }
        ExecutionStatus status = dispatcher.describe(ref);
        if (status == ExecutionStatus.RUNNING || status == ExecutionStatus.UNKNOWN) {
            endedSince.remove(ref);
            return;
        }
        Instant first = endedSince.computeIfAbsent(ref, r -> now);
        if (Duration.between(first, now).compareTo(grace) < 0) {
            return;
        }
        // The worker may have reported in the meantime: decide from the row as it is now.
        JobRow fresh = jobs.find(job.id()).orElse(null);
        if (fresh == null || !JobRow.RUNNING.equals(fresh.status()) || !ref.equals(fresh.executionRef())) {
            endedSince.remove(ref);
            return;
        }
        boolean neverStarted = "queued".equals(fresh.state()) || "waiting-for-slot".equals(fresh.state());
        if (neverStarted && fresh.restarted() == 0) {
            try {
                if (jobService.restart(fresh)) {
                    endedSince.remove(ref);
                }
            } catch (RuntimeException e) {
                LOG.error("could not restart job {}", fresh.id(), e);
                jobService.failJob(fresh.id(), JobRow.RUNNING, ref, "ORCHESTRATOR_START_FAILED", "The index could not be restarted.");
            }
            return;
        }
        String code = neverStarted ? "runtime-not-started" : status == ExecutionStatus.TIMED_OUT ? "runtime-timeout" : "runtime-error";
        jobService.failJob(fresh.id(), JobRow.RUNNING, ref, code, "The index run ended without a result.");
    }
}
