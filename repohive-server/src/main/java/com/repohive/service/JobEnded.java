package com.repohive.service;

/** Published after a job leaves RUNNING (ended, or sent back to the queue), so waiting jobs can take the slot. */
public record JobEnded(String jobId) {}
