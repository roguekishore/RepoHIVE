package com.repohive.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class SignInFailureRepository {

    private final JdbcTemplate jdbc;

    public SignInFailureRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public int countForAccountSince(String accountId, String since) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM sign_in_failures WHERE account_id = ? AND failed_at >= ?", Integer.class, accountId, since);
        return count == null ? 0 : count;
    }

    public int countForIpSince(String ip, String since) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM sign_in_failures WHERE ip = ? AND failed_at >= ?", Integer.class, ip, since);
        return count == null ? 0 : count;
    }

    /** accountId is null when the email matched no account. */
    public void insert(String id, String accountId, String ip, String failedAt) {
        jdbc.update("INSERT INTO sign_in_failures (id, account_id, ip, failed_at) VALUES (?, ?, ?, ?)", id, accountId, ip, failedAt);
    }
}
