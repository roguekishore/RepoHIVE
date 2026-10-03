package com.repohive.service;

import com.repohive.model.IndexedRepo;
import com.repohive.model.PrecheckResult;
import com.repohive.model.QuotaRejectCode;
import com.repohive.model.QuotaResult;
import com.repohive.repository.IndexedRepoRepository;
import com.repohive.repository.JobRepository;
import java.time.Clock;
import java.util.Optional;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** POST /api/index after the HTTP checks: pre-check, cache, join, reserve, dispatch (port of process-index-request.ts). */
@Service
public class IntakeService {

    public static final int GLOBAL_CAP = 5;
    public static final int BUSY_RETRY_SECONDS = 120;

    public sealed interface Outcome {
        record Cached(String repo, String snapshotId) implements Outcome {}

        record Joined(String jobId) implements Outcome {}

        record Accepted(String jobId) implements Outcome {}

        record Rejected(int httpStatus, String code, String message) implements Outcome {}

        record Busy(int retryAfterSeconds) implements Outcome {}
    }

    private sealed interface Reservation {
        record Reserved() implements Reservation {}

        record QuotaRejected(QuotaRejectCode code) implements Reservation {}

        record AtCap() implements Reservation {}

        record Raced() implements Reservation {}
    }

    private final PrecheckRunner precheck;
    private final QuotaService quota;
    private final JobRepository jobs;
    private final IndexedRepoRepository repos;
    private final JobService jobService;
    private final MetricsEmitter metrics;
    private final Clock clock;
    private final TransactionTemplate tx;

    public IntakeService(
            PrecheckRunner precheck,
            QuotaService quota,
            JobRepository jobs,
            IndexedRepoRepository repos,
            JobService jobService,
            MetricsEmitter metrics,
            Clock clock,
            PlatformTransactionManager txManager) {
        this.clock = clock;
        this.precheck = precheck;
        this.quota = quota;
        this.jobs = jobs;
        this.repos = repos;
        this.jobService = jobService;
        this.metrics = metrics;
        this.tx = new TransactionTemplate(txManager);
    }

    /** The outcome, with its metrics recorded. A pre-check crash is a {@link PrecheckFailedException}. */
    public Outcome process(String accountId, String ip, String repoText) {
        Outcome outcome = decide(accountId, ip, repoText);
        metrics.inFlight(jobs.countOpen());
        switch (outcome) {
            case Outcome.Accepted a -> metrics.jobsAccepted();
            case Outcome.Cached c -> metrics.jobsCacheHit();
            case Outcome.Joined j -> metrics.jobsJoined();
            case Outcome.Rejected r -> metrics.jobsRejected(r.code());
            case Outcome.Busy b -> metrics.jobsRejected("INFLIGHT_CAP");
        }
        return outcome;
    }

    private Outcome decide(String accountId, String ip, String repoText) {
        QuotaResult limit = quota.recordPrecheckAttempt(accountId, ip);
        if (!limit.ok()) {
            return quotaRejection(limit.rejection());
        }

        PrecheckResult result = precheck.run(repoText);
        if (result instanceof PrecheckResult.Rejected rejected) {
            return new Outcome.Rejected(422, rejected.code(), rejected.message());
        }
        PrecheckResult.Accepted checked = (PrecheckResult.Accepted) result;

        Optional<IndexedRepo> indexed = repos.find(checked.repo());
        if (indexed.isPresent() && indexed.get().snapshotId().equals(checked.snapshotId())) {
            return new Outcome.Cached(checked.repo(), checked.snapshotId());
        }
        Optional<String> open = jobs.findOpenJobId(checked.repo());
        if (open.isPresent()) {
            return new Outcome.Joined(open.get());
        }

        String jobId = Ids.randomId();
        Reservation reservation = reserve(accountId, ip, jobId, checked);
        switch (reservation) {
            case Reservation.QuotaRejected q -> {
                return quotaRejection(q.code());
            }
            case Reservation.AtCap c -> {
                return new Outcome.Busy(BUSY_RETRY_SECONDS);
            }
            case Reservation.Raced r -> {
                return jobs.findOpenJobId(checked.repo())
                        .<Outcome>map(Outcome.Joined::new)
                        .orElseGet(() -> new Outcome.Busy(BUSY_RETRY_SECONDS));
            }
            case Reservation.Reserved r -> {
                // fall through to dispatch
            }
        }

        if (jobService.dispatch(jobId) == JobService.DispatchOutcome.START_FAILED) {
            return new Outcome.Rejected(503, "ORCHESTRATOR_START_FAILED",
                    "The index could not be started. Your request was not charged.");
        }
        return new Outcome.Accepted(jobId);
    }

    private static Outcome quotaRejection(QuotaRejectCode code) {
        return new Outcome.Rejected(429, code.name(), QuotaMessages.quotaMessage(code));
    }

    /** One transaction: quota checks and the charge, the global cap, the job row. A rejection writes nothing. */
    private Reservation reserve(String accountId, String ip, String jobId, PrecheckResult.Accepted checked) {
        return tx.execute(status -> {
            QuotaResult reserved = quota.reserveCharge(accountId, ip, jobId);
            if (!reserved.ok()) {
                status.setRollbackOnly();
                return new Reservation.QuotaRejected(reserved.rejection());
            }
            if (jobs.countOpen() >= GLOBAL_CAP) {
                status.setRollbackOnly();
                return new Reservation.AtCap();
            }
            try {
                jobs.insert(jobId, checked.repo(), checked.commitSha(), checked.snapshotId(), accountId, checked.tier(),
                        TimeFormat.iso(clock.instant()));
            } catch (DataAccessException e) {
                if (isUniqueViolation(e)) {
                    status.setRollbackOnly();
                    return new Reservation.Raced();
                }
                throw e;
            }
            return new Reservation.Reserved();
        });
    }

    private static boolean isUniqueViolation(Throwable error) {
        for (Throwable t = error; t != null; t = t.getCause()) {
            if (t.getMessage() != null && t.getMessage().contains("UNIQUE")) {
                return true;
            }
        }
        return false;
    }
}
