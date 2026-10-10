package com.repohive.service;

import com.repohive.model.JobRow;
import com.repohive.repository.JobRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Starts queued L/XL jobs, oldest first, whenever the shared large slot may be free: when a job ends and on a
 * periodic tick. {@link JobService#dispatch} makes the actual decision; this only walks the queue.
 */
@Component
public class SlotDispatcher {

    private static final Logger LOG = LoggerFactory.getLogger(SlotDispatcher.class);

    private final JobRepository jobs;
    private final JobService jobService;

    public SlotDispatcher(JobRepository jobs, JobService jobService) {
        this.jobs = jobs;
        this.jobService = jobService;
    }

    @EventListener
    void onJobEnded(JobEnded event) {
        run();
    }

    @Scheduled(
            initialDelayString = "${repohive.slot.initial-delay-ms:5000}",
            fixedDelayString = "${repohive.slot.interval-ms:5000}")
    public void run() {
        try {
            for (JobRow job : jobs.queuedLarge()) {
                if (jobService.dispatch(job.id()) == JobService.DispatchOutcome.WAITING) {
                    break;
                }
            }
        } catch (RuntimeException e) {
            LOG.error("slot dispatch failed", e);
        }
    }
}
