package com.repohive.service;

import com.repohive.model.AccountRecord;
import com.repohive.repository.AccountRepository;
import com.repohive.repository.BenchRepository;
import com.repohive.repository.BenchRepository.Active;
import com.repohive.repository.BenchRepository.AuditRow;
import com.repohive.repository.BenchRepository.Found;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Accounts flagged for benchmarking. A flagged account is not held to the per-account and per-IP quotas, the one
 * index in flight per account, or the global in-flight cap, until its flag ends on its own (at most
 * {@link #MAX_HOURS} hours) or is switched off. Everything else (pre-check, one job per repository, the L and XL
 * slot, Lambda and Fargate capacity) applies as usual.
 */
@Service
public class BenchAccounts {

    public static final int MAX_HOURS = 72;
    public static final int DEFAULT_HOURS = 12;
    private static final int SEARCH_LIMIT = 20;

    private final BenchRepository repository;
    private final AccountRepository accounts;
    private final Clock clock;
    private final TransactionTemplate tx;

    public BenchAccounts(
            BenchRepository repository, AccountRepository accounts, Clock clock, PlatformTransactionManager txManager) {
        this.repository = repository;
        this.accounts = accounts;
        this.clock = clock;
        this.tx = new TransactionTemplate(txManager);
    }

    /** Asked on every pre-check and reservation; one primary-key lookup. */
    public boolean isActive(String accountId) {
        return repository.isActive(accountId, TimeFormat.iso(clock.instant()));
    }

    public Optional<AccountRecord> findAccount(String email) {
        return accounts.findByEmail(EmailRules.normalize(email));
    }

    /** Flags the account for the given hours from now (replacing any earlier flag); returns when it ends. */
    public String enable(AccountRecord account, int hours, String fromIp) {
        Instant now = clock.instant();
        String expires = TimeFormat.iso(now.plus(Duration.ofHours(hours)));
        tx.executeWithoutResult(status -> {
            repository.upsert(account.id(), TimeFormat.iso(now), expires);
            repository.insertAudit(account.id(), account.email(), "ENABLED", expires, TimeFormat.iso(now), fromIp);
        });
        return expires;
    }

    /** Switches the flag off; false when the account had none in force. */
    public boolean disable(AccountRecord account, String fromIp) {
        Instant now = clock.instant();
        return Boolean.TRUE.equals(tx.execute(status -> {
            boolean wasActive = repository.isActive(account.id(), TimeFormat.iso(now));
            repository.delete(account.id());
            if (wasActive) {
                repository.insertAudit(account.id(), account.email(), "DISABLED", null, TimeFormat.iso(now), fromIp);
            }
            return wasActive;
        }));
    }

    public List<Active> active() {
        String now = TimeFormat.iso(clock.instant());
        repository.deleteEnded(now);
        return repository.active(now);
    }

    /** Accounts whose email contains the text; an empty text lists the newest. */
    public List<Found> search(String text) {
        String escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        return repository.search(escaped, TimeFormat.iso(clock.instant()), SEARCH_LIMIT);
    }

    public List<AuditRow> recent(int limit) {
        return repository.recentAudit(limit);
    }
}
