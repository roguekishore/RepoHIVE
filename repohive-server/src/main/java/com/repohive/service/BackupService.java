package com.repohive.service;

import com.repohive.config.AppConfig;
import com.repohive.repository.BackupStateRepository;
import com.repohive.store.ObjectStore;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Daily SQLite backup into the object store, newest 7 kept (port of worker/backup.ts). */
@Service
public class BackupService {

    static final String BACKUP_PREFIX = "backup/";
    static final int RETAIN_DAYS = 7;

    private final JdbcTemplate jdbc;
    private final BackupStateRepository state;
    private final ObjectStore store;
    private final Clock clock;
    private final Path databaseFile;

    public BackupService(JdbcTemplate jdbc, BackupStateRepository state, ObjectStore store, Clock clock, AppConfig config) {
        this.jdbc = jdbc;
        this.state = state;
        this.store = store;
        this.clock = clock;
        this.databaseFile = config.databaseFile();
    }

    static String backupKeyForDay(String utcDay) {
        return BACKUP_PREFIX + "app-" + utcDay + ".sqlite";
    }

    /** Backs up when today's backup has not been taken yet. No transaction is held across the upload. */
    public boolean maybeBackup() {
        String today = TimeFormat.utcDay(clock.instant());
        if (state.lastBackupDay().filter(today::equals).isPresent()) {
            return false;
        }

        Path tempDir = databaseFile.toAbsolutePath().getParent().resolve(".backup-tmp");
        Path tempFile = tempDir.resolve("app-" + today + ".sqlite");
        byte[] body;
        try {
            Files.createDirectories(tempDir);
            Files.deleteIfExists(tempFile);
            jdbc.execute("VACUUM INTO '" + tempFile.toString().replace("'", "''") + "'");
            body = Files.readAllBytes(tempFile);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        store.put(backupKeyForDay(today), body, "application/x-sqlite3");

        List<String> dated = store.list(BACKUP_PREFIX).stream()
                .filter(key -> key.startsWith(BACKUP_PREFIX + "app-") && key.endsWith(".sqlite"))
                .sorted((a, b) -> b.compareTo(a))
                .toList();
        if (dated.size() > RETAIN_DAYS) {
            store.delete(dated.subList(RETAIN_DAYS, dated.size()));
        }

        try {
            Files.deleteIfExists(tempFile);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        state.recordBackupDay(today);
        return true;
    }
}
