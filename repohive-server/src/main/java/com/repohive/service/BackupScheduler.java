package com.repohive.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Runs the backup on a schedule. Set repohive.backup.enabled=false to switch it off (tests do). */
@Component
@ConditionalOnProperty(name = "repohive.backup.enabled", havingValue = "true", matchIfMissing = true)
public class BackupScheduler {

    private static final Logger LOG = LoggerFactory.getLogger(BackupScheduler.class);

    private final BackupService backups;

    public BackupScheduler(BackupService backups) {
        this.backups = backups;
    }

    @Scheduled(
            initialDelayString = "${repohive.backup.initial-delay-ms:60000}",
            fixedDelayString = "${repohive.backup.interval-ms:3600000}")
    public void run() {
        try {
            if (backups.maybeBackup()) {
                LOG.info("database backup uploaded");
            }
        } catch (RuntimeException e) {
            LOG.error("database backup failed", e);
        }
    }
}
