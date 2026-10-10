package com.repohive.service;

import com.repohive.config.AppConfig;
import com.repohive.config.QuotaLimits;
import com.repohive.repository.SettingsRepository;
import com.repohive.repository.SettingsRepository.AuditRow;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.ToIntFunction;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The limits in force. The environment supplies the defaults; a value saved through the admin API overrides its
 * default, survives restarts, and takes effect within {@link #CACHE_TTL} (at once on this instance, because a save
 * refreshes the cache). Every read goes through {@link #current()}: do not hold the result across calls.
 */
@Service
public class RuntimeLimits {

    /** How long a read of the settings table is reused. */
    static final Duration CACHE_TTL = Duration.ofSeconds(5);

    /** The lowest value an operator may save: a limit of zero would be a switch, not a limit. */
    public static final int MIN = 1;

    /** A limit, its JSON key, and the highest value an operator may save (a larger value is clamped to it). */
    public enum Limit {
        ACCOUNT_DAY("acceptedPerAccountPerDay", 100, QuotaLimits::acceptedPerAccountPerDay),
        IP_DAY("acceptedPerIpPerDay", 500, QuotaLimits::acceptedPerIpPerDay),
        PRECHECK_ACCOUNT_HOUR("prechecksPerAccountPerHour", 500, QuotaLimits::prechecksPerAccountPerHour),
        PRECHECK_IP_HOUR("prechecksPerIpPerHour", 2000, QuotaLimits::prechecksPerIpPerHour),
        IN_FLIGHT_CAP("inFlightCap", 50, QuotaLimits::inFlightCap),
        SIGNUPS_PER_IP_DAY("signUpsPerIpPerDay", 100, QuotaLimits::signUpsPerIpPerDay);

        private final String key;
        private final int max;
        private final ToIntFunction<QuotaLimits> read;

        Limit(String key, int max, ToIntFunction<QuotaLimits> read) {
            this.key = key;
            this.max = max;
            this.read = read;
        }

        public String key() {
            return key;
        }

        public int max() {
            return max;
        }

        int valueIn(QuotaLimits limits) {
            return read.applyAsInt(limits);
        }

        public static Optional<Limit> byKey(String key) {
            for (Limit limit : values()) {
                if (limit.key.equals(key)) {
                    return Optional.of(limit);
                }
            }
            return Optional.empty();
        }
    }

    /** One limit as the admin page shows it. */
    public record Entry(Limit limit, int value, int defaultValue, boolean overridden) {}

    public record Change(Limit limit, int oldValue, int newValue) {}

    /** What a save did: the changes written (none when every value already held) and the limits clamped to their maximum. */
    public record UpdateResult(List<Change> changes, List<Limit> clamped) {}

    private record Snapshot(Map<String, Integer> overrides, Instant loadedAt) {}

    private final SettingsRepository repository;
    private final QuotaLimits defaults;
    private final Clock clock;
    private final TransactionTemplate tx;
    private volatile Snapshot snapshot;

    public RuntimeLimits(SettingsRepository repository, AppConfig config, Clock clock, PlatformTransactionManager txManager) {
        this.repository = repository;
        this.defaults = config.quota();
        this.clock = clock;
        this.tx = new TransactionTemplate(txManager);
    }

    /** The limits in force now. */
    public QuotaLimits current() {
        Map<String, Integer> overrides = overrides();
        int[] values = new int[Limit.values().length];
        for (Limit limit : Limit.values()) {
            values[limit.ordinal()] = overrides.getOrDefault(limit.key(), limit.valueIn(defaults));
        }
        return new QuotaLimits(values[0], values[1], values[2], values[3], values[4], values[5]);
    }

    public QuotaLimits defaults() {
        return defaults;
    }

    public List<Entry> entries() {
        Map<String, Integer> overrides = overrides();
        List<Entry> entries = new ArrayList<>();
        for (Limit limit : Limit.values()) {
            Integer saved = overrides.get(limit.key());
            int fallback = limit.valueIn(defaults);
            entries.add(new Entry(limit, saved == null ? fallback : saved, fallback, saved != null));
        }
        return entries;
    }

    /** Newest first. */
    public List<AuditRow> recentChanges(int limit) {
        return repository.recentAudit(limit);
    }

    /**
     * Saves the given values: a number above the limit's maximum is clamped to it, a null value removes the override
     * so the default applies again. A value that already holds writes nothing. Callers reject numbers below
     * {@link #MIN} first.
     */
    public synchronized UpdateResult update(Map<Limit, Integer> requested, String fromIp) {
        Instant now = clock.instant();
        String at = TimeFormat.iso(now);
        try {
            return tx.execute(status -> {
                Map<String, Integer> saved = repository.all();
                List<Change> changes = new ArrayList<>();
                List<Limit> clamped = new ArrayList<>();
                for (Map.Entry<Limit, Integer> request : requested.entrySet()) {
                    Limit limit = request.getKey();
                    Integer wanted = request.getValue();
                    int before = saved.getOrDefault(limit.key(), limit.valueIn(defaults));
                    if (wanted == null) {
                        if (saved.containsKey(limit.key())) {
                            repository.delete(limit.key());
                            int after = limit.valueIn(defaults);
                            if (after != before) {
                                repository.insertAudit(limit.key(), before, after, at, fromIp);
                                changes.add(new Change(limit, before, after));
                            }
                        }
                        continue;
                    }
                    int after = Math.min(wanted, limit.max());
                    if (after != wanted) {
                        clamped.add(limit);
                    }
                    if (saved.containsKey(limit.key()) && after == before) {
                        continue;
                    }
                    repository.upsert(limit.key(), after, at);
                    if (after != before) {
                        repository.insertAudit(limit.key(), before, after, at, fromIp);
                        changes.add(new Change(limit, before, after));
                    }
                }
                return new UpdateResult(changes, clamped);
            });
        } finally {
            snapshot = null;
        }
    }

    private Map<String, Integer> overrides() {
        Snapshot held = snapshot;
        Instant now = clock.instant();
        if (held == null || held.loadedAt().plus(CACHE_TTL).isBefore(now) || held.loadedAt().isAfter(now)) {
            held = new Snapshot(new LinkedHashMap<>(repository.all()), now);
            snapshot = held;
        }
        return held.overrides();
    }
}
