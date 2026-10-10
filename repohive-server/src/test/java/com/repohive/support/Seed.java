package com.repohive.support;

import com.repohive.service.Ids;
import com.repohive.service.TimeFormat;
import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;

/** Direct rows for tests that drive the services rather than HTTP. */
public final class Seed {

    private Seed() {}

    public static String account(JdbcTemplate jdbc) {
        String id = Ids.randomId();
        jdbc.update("INSERT INTO accounts (id, email, password_salt, password_hash, scrypt_n, scrypt_r, scrypt_p, created_at, created_utc_day, created_ip)"
                + " VALUES (?, ?, 'aa', 'bb', 1, 1, 1, '2026-10-03T12:00:00.000Z', '2026-10-03', '1.1.1.1')", id, id + "@example.com");
        return id;
    }

    /** A QUEUED job with its charge. */
    public static String job(JdbcTemplate jdbc, Instant now, String accountId, String repo, String tier) {
        String id = Ids.randomId();
        String at = TimeFormat.iso(now);
        jdbc.update("INSERT INTO job_executions (id, repo, commit_sha, snapshot_id, account_id, tier, status, state, created_at, queued_at, updated_at)"
                + " VALUES (?, ?, 'c0ffee', ?, ?, ?, 'QUEUED', 'queued', ?, ?, ?)", id, repo, "5".repeat(32), accountId, tier, at, at, at);
        jdbc.update("INSERT INTO index_charges (job_id, account_id, ip, utc_day, charged_at, refunded) VALUES (?, ?, '1.1.1.1', ?, ?, 0)",
                id, accountId, TimeFormat.utcDay(now), at);
        return id;
    }

    public static void clear(JdbcTemplate jdbc) {
        jdbc.update("DELETE FROM job_executions");
        jdbc.update("DELETE FROM index_charges");
        jdbc.update("DELETE FROM indexed_repositories");
    }
}
