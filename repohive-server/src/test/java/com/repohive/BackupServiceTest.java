package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.repository.BackupStateRepository;
import com.repohive.service.BackupService;
import com.repohive.store.LocalObjectStore;
import com.repohive.store.ObjectStore;
import com.repohive.support.TestClock;
import com.repohive.support.TestClockConfig;
import com.repohive.support.TestEnv;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest
@Import(TestClockConfig.class)
class BackupServiceTest {

    static final Path DIR = TestEnv.tempDir();

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        TestEnv.local(registry, DIR);
    }

    @Autowired BackupService backups;
    @Autowired BackupStateRepository state;
    @Autowired ObjectStore store;
    @Autowired TestClock clock;

    @Test
    void backsUpOncePerDayKeepsTheSevenNewestAndRecordsTheDay() throws Exception {
        assertThat(store).isInstanceOf(LocalObjectStore.class);
        clock.reset();
        assertThat(state.lastBackupDay()).isEmpty();

        assertThat(backups.maybeBackup()).isTrue();
        assertThat(state.lastBackupDay()).contains("2026-10-03");
        assertThat(store.list("backup/")).containsExactly("backup/app-2026-10-03.sqlite");
        Path object = DIR.resolve("store/backup/app-2026-10-03.sqlite");
        assertThat(Files.readAllBytes(object)).startsWith("SQLite format 3\0".getBytes(StandardCharsets.US_ASCII));
        assertThat(Files.readString(Path.of(object + ".headers.json"))).isEqualTo("{\"contentType\":\"application/x-sqlite3\"}");
        assertThat(DIR.resolve("data/.backup-tmp/app-2026-10-03.sqlite")).doesNotExist();

        // Same day: nothing happens, later in the day too.
        assertThat(backups.maybeBackup()).isFalse();
        clock.advance(Duration.ofHours(11));
        assertThat(backups.maybeBackup()).isFalse();
        assertThat(store.list("backup/")).hasSize(1);

        // Eight more days: 9 backups taken, only the newest 7 kept.
        for (int day = 1; day <= 8; day++) {
            clock.set(java.time.Instant.parse("2026-10-03T12:00:00Z").plus(Duration.ofDays(day)));
            assertThat(backups.maybeBackup()).as("day +" + day).isTrue();
        }
        List<String> kept = store.list("backup/");
        assertThat(kept).containsExactly(
                "backup/app-2026-10-05.sqlite", "backup/app-2026-10-06.sqlite", "backup/app-2026-10-07.sqlite",
                "backup/app-2026-10-08.sqlite", "backup/app-2026-10-09.sqlite", "backup/app-2026-10-10.sqlite",
                "backup/app-2026-10-11.sqlite");
        assertThat(DIR.resolve("store/backup/app-2026-10-03.sqlite")).doesNotExist();
        assertThat(DIR.resolve("store/backup/app-2026-10-03.sqlite.headers.json")).doesNotExist();
        assertThat(state.lastBackupDay()).contains("2026-10-11");
        clock.reset();
    }
}
