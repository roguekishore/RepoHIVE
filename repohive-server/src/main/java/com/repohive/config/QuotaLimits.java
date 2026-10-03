package com.repohive.config;

public record QuotaLimits(
        int acceptedPerAccountPerDay,
        int acceptedPerIpPerDay,
        int prechecksPerAccountPerHour,
        int prechecksPerIpPerHour) {

    public static final QuotaLimits DEFAULTS = new QuotaLimits(5, 10, 20, 40);
}
