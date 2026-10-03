package com.repohive.repository;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class BackupStateRepository {

    private final JdbcTemplate jdbc;

    public BackupStateRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<String> lastBackupDay() {
        List<String> rows = jdbc.query("SELECT last_backup_utc_day FROM backup_state WHERE id = 1", (rs, i) -> rs.getString(1));
        return rows.stream().filter(day -> day != null).findFirst();
    }

    public void recordBackupDay(String utcDay) {
        jdbc.update(
                "INSERT INTO backup_state (id, last_backup_utc_day) VALUES (1, ?)"
                        + " ON CONFLICT(id) DO UPDATE SET last_backup_utc_day = excluded.last_backup_utc_day",
                utcDay);
    }
}
