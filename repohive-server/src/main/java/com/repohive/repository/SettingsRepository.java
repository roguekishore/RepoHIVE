package com.repohive.repository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Saved runtime settings and the audit trail of their changes. */
@Repository
public class SettingsRepository {

    public record AuditRow(String key, int oldValue, int newValue, String changedAt, String changedFromIp) {}

    private final JdbcTemplate jdbc;

    public SettingsRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Integer> all() {
        Map<String, Integer> values = new LinkedHashMap<>();
        jdbc.query("SELECT key, value FROM settings ORDER BY key", rs -> {
            values.put(rs.getString("key"), rs.getInt("value"));
        });
        return values;
    }

    public void upsert(String key, int value, String updatedAt) {
        jdbc.update(
                "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
                        + " ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                key, value, updatedAt);
    }

    public void delete(String key) {
        jdbc.update("DELETE FROM settings WHERE key = ?", key);
    }

    public void insertAudit(String key, int oldValue, int newValue, String changedAt, String changedFromIp) {
        jdbc.update(
                "INSERT INTO settings_audit (key, old_value, new_value, changed_at, changed_from_ip) VALUES (?, ?, ?, ?, ?)",
                key, oldValue, newValue, changedAt, changedFromIp);
    }

    /** Newest first. */
    public List<AuditRow> recentAudit(int limit) {
        return jdbc.query(
                "SELECT key, old_value, new_value, changed_at, changed_from_ip FROM settings_audit"
                        + " ORDER BY id DESC LIMIT ?",
                (rs, row) -> new AuditRow(
                        rs.getString("key"),
                        rs.getInt("old_value"),
                        rs.getInt("new_value"),
                        rs.getString("changed_at"),
                        rs.getString("changed_from_ip")),
                limit);
    }
}
