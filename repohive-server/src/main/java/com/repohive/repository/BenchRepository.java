package com.repohive.repository;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Accounts flagged for benchmarking until a time, and the audit trail of flagging them. */
@Repository
public class BenchRepository {

    public record Active(String accountId, String email, String enabledAt, String expiresAt) {}

    /** An account found by search; benchUntil is null when it is not flagged (or the flag has ended). */
    public record Found(String accountId, String email, String benchUntil) {}

    public record AuditRow(String email, String action, String expiresAt, String changedAt, String changedFromIp) {}

    private final JdbcTemplate jdbc;

    public BenchRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean isActive(String accountId, String nowIso) {
        return !jdbc.queryForList(
                        "SELECT 1 FROM bench_accounts WHERE account_id = ? AND expires_at > ?", Integer.class, accountId, nowIso)
                .isEmpty();
    }

    public void upsert(String accountId, String enabledAt, String expiresAt) {
        jdbc.update(
                "INSERT INTO bench_accounts (account_id, enabled_at, expires_at) VALUES (?, ?, ?)"
                        + " ON CONFLICT (account_id) DO UPDATE SET enabled_at = excluded.enabled_at, expires_at = excluded.expires_at",
                accountId, enabledAt, expiresAt);
    }

    /** True when a row (live or ended) was removed. */
    public boolean delete(String accountId) {
        return jdbc.update("DELETE FROM bench_accounts WHERE account_id = ?", accountId) > 0;
    }

    public void deleteEnded(String nowIso) {
        jdbc.update("DELETE FROM bench_accounts WHERE expires_at <= ?", nowIso);
    }

    /** Flags still in force, the one ending soonest first. */
    public List<Active> active(String nowIso) {
        return jdbc.query(
                "SELECT b.account_id, a.email, b.enabled_at, b.expires_at FROM bench_accounts b"
                        + " JOIN accounts a ON a.id = b.account_id WHERE b.expires_at > ? ORDER BY b.expires_at, a.email",
                (rs, i) -> new Active(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4)),
                nowIso);
    }

    /** Accounts whose email contains the text (already escaped for LIKE), the newest accounts first. */
    public List<Found> search(String escapedText, String nowIso, int limit) {
        return jdbc.query(
                "SELECT a.id, a.email, b.expires_at FROM accounts a"
                        + " LEFT JOIN bench_accounts b ON b.account_id = a.id AND b.expires_at > ?"
                        + " WHERE a.email LIKE ? ESCAPE '\\' ORDER BY a.created_at DESC, a.email LIMIT ?",
                (rs, i) -> new Found(rs.getString(1), rs.getString(2), rs.getString(3)),
                nowIso, "%" + escapedText + "%", limit);
    }

    public void insertAudit(String accountId, String email, String action, String expiresAt, String changedAt, String ip) {
        jdbc.update(
                "INSERT INTO bench_audit (account_id, email, action, expires_at, changed_at, changed_from_ip)"
                        + " VALUES (?, ?, ?, ?, ?, ?)",
                accountId, email, action, expiresAt, changedAt, ip);
    }

    /** Newest first. */
    public List<AuditRow> recentAudit(int limit) {
        return jdbc.query(
                "SELECT email, action, expires_at, changed_at, changed_from_ip FROM bench_audit ORDER BY id DESC LIMIT ?",
                (rs, i) -> new AuditRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5)),
                limit);
    }
}
