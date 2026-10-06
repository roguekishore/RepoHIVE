package com.repohive.service;

import com.repohive.config.QuotaLimits;
import com.repohive.model.QuotaRejectCode;
import com.repohive.model.QuotaResult;
import com.repohive.model.RemainingQuota;
import com.repohive.repository.QuotaRepository;
import java.time.Clock;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Pre-check rate limits, daily quota, charges and refunds (port of quota/quota.ts). */
@Service
public class QuotaService {

    /** Stands in for the address on a benchmark account's charges. */
    static final String BENCH_IP = "bench";

    private final QuotaRepository repository;
    private final RuntimeLimits runtimeLimits;
    private final BenchAccounts bench;
    private final Clock clock;
    private final TransactionTemplate tx;

    public QuotaService(
            QuotaRepository repository,
            RuntimeLimits runtimeLimits,
            BenchAccounts bench,
            Clock clock,
            PlatformTransactionManager txManager) {
        this.repository = repository;
        this.runtimeLimits = runtimeLimits;
        this.bench = bench;
        this.clock = clock;
        this.tx = new TransactionTemplate(txManager);
    }

    private static String bucketKey(String kind, String id, String hour) {
        return kind + ":" + id + ":" + hour;
    }

    private boolean incrementPrecheckBucket(String bucket, int limit) {
        var count = repository.precheckCount(bucket);
        if (count.orElse(0) >= limit) {
            return false;
        }
        if (count.isEmpty()) {
            repository.insertPrecheckBucket(bucket);
        } else {
            repository.incrementPrecheckBucket(bucket);
        }
        return true;
    }

    /** One pre-check attempt against the hourly account then IP limits; all or nothing. */
    public QuotaResult recordPrecheckAttempt(String accountId, String ip) {
        if (bench.isActive(accountId)) {
            return QuotaResult.OK;
        }
        String hour = TimeFormat.utcHour(clock.instant());
        QuotaLimits limits = runtimeLimits.current();
        return tx.execute(status -> {
            if (!incrementPrecheckBucket(bucketKey("account", accountId, hour), limits.prechecksPerAccountPerHour())) {
                status.setRollbackOnly();
                return QuotaResult.rejected(QuotaRejectCode.PRECHECK_ACCOUNT_LIMIT);
            }
            if (!incrementPrecheckBucket(bucketKey("ip", ip, hour), limits.prechecksPerIpPerHour())) {
                status.setRollbackOnly();
                return QuotaResult.rejected(QuotaRejectCode.PRECHECK_IP_LIMIT);
            }
            return QuotaResult.OK;
        });
    }

    public RemainingQuota remaining(String accountId, String ip) {
        String day = TimeFormat.utcDay(clock.instant());
        QuotaLimits limits = runtimeLimits.current();
        int accountUsed = repository.countAccountCharges(accountId, day);
        int ipUsed = repository.countIpCharges(ip, day);
        return new RemainingQuota(
                Math.max(0, limits.acceptedPerAccountPerDay() - accountUsed),
                Math.max(0, limits.acceptedPerIpPerDay() - ipUsed),
                limits.acceptedPerAccountPerDay(),
                limits.acceptedPerIpPerDay());
    }

    /**
     * In-flight, account quota and IP quota checks, then the charge row. Call it inside the caller's
     * transaction; a rejection writes nothing.
     */
    public QuotaResult reserveCharge(String accountId, String ip, String jobId) {
        Instant now = clock.instant();
        String day = TimeFormat.utcDay(now);
        QuotaLimits limits = runtimeLimits.current();
        // A benchmark account is charged like any other (so a refund still works) but is never turned away by these,
        // and its charges are filed under "bench" rather than its address so they cannot use up the quota of ordinary
        // users who share that address.
        boolean benchmarking = bench.isActive(accountId);
        if (!benchmarking) {
            if (repository.hasAccountInflight(accountId)) {
                return QuotaResult.rejected(QuotaRejectCode.INFLIGHT);
            }
            if (repository.countAccountCharges(accountId, day) >= limits.acceptedPerAccountPerDay()) {
                return QuotaResult.rejected(QuotaRejectCode.QUOTA_ACCOUNT);
            }
            if (repository.countIpCharges(ip, day) >= limits.acceptedPerIpPerDay()) {
                return QuotaResult.rejected(QuotaRejectCode.QUOTA_IP);
            }
        }
        repository.insertCharge(jobId, accountId, benchmarking ? BENCH_IP : ip, day, TimeFormat.iso(now));
        return QuotaResult.OK;
    }

    /** Refunds a system failure exactly once; true when this call changed the charge. */
    public boolean refund(String jobId) {
        return repository.markRefunded(jobId);
    }

    /** Undoes reserveCharge when the job could not be created. */
    public void release(String jobId) {
        repository.deleteCharge(jobId);
    }
}
