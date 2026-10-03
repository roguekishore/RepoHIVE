package com.repohive.model;

public record HealthReport(String status, String version, boolean ledgerReachable, String lastCompletedJobAt) {}
