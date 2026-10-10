package com.repohive.config;

/**
 * The limits an operator can change while the server runs. The record read from the environment is the default;
 * a saved runtime value overrides it (see RuntimeLimits).
 */
public record QuotaLimits(
        int acceptedPerAccountPerDay,
        int acceptedPerIpPerDay,
        int prechecksPerAccountPerHour,
        int prechecksPerIpPerHour,
        /** Open (queued or running) jobs across all accounts. */
        int inFlightCap,
        int signUpsPerIpPerDay) {

    public static final QuotaLimits DEFAULTS = new QuotaLimits(5, 10, 20, 40, 5, 3);
}
