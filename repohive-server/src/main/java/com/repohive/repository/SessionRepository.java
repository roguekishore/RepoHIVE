package com.repohive.repository;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class SessionRepository {

    /** A session joined to its account. */
    public record SessionRow(String accountId, String email, String expiresAt) {}

    private final JdbcTemplate jdbc;

    public SessionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(String tokenHash, String accountId, String expiresAt, String createdAt) {
        jdbc.update(
                "INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
                tokenHash, accountId, expiresAt, createdAt);
    }

    public void delete(String tokenHash) {
        jdbc.update("DELETE FROM sessions WHERE token_hash = ?", tokenHash);
    }

    public Optional<SessionRow> find(String tokenHash) {
        List<SessionRow> rows = jdbc.query(
                "SELECT s.account_id, a.email, s.expires_at FROM sessions s"
                        + " INNER JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?",
                (rs, i) -> new SessionRow(rs.getString("account_id"), rs.getString("email"), rs.getString("expires_at")),
                tokenHash);
        return rows.stream().findFirst();
    }
}
