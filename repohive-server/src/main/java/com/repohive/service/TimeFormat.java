package com.repohive.service;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/**
 * The one place timestamps are formatted. Stored timestamps are ISO-8601 UTC with exactly three fractional
 * digits and a Z, so comparing them as strings orders them in time. Never use Instant.toString() for storage.
 */
public final class TimeFormat {

    private static final DateTimeFormatter ISO =
            DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT).withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter DAY =
            DateTimeFormatter.ofPattern("uuuu-MM-dd", Locale.ROOT).withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter HOUR =
            DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH", Locale.ROOT).withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter HTTP_DATE =
            DateTimeFormatter.ofPattern("EEE, dd MMM uuuu HH:mm:ss 'GMT'", Locale.ENGLISH).withZone(ZoneOffset.UTC);

    private TimeFormat() {}

    /** {@code 2026-10-03T12:00:00.000Z}. */
    public static String iso(Instant instant) {
        return ISO.format(instant);
    }

    public static Instant parseIso(String text) {
        return Instant.from(ISO.parse(text));
    }

    /** UTC calendar day {@code YYYY-MM-DD}. */
    public static String utcDay(Instant instant) {
        return DAY.format(instant);
    }

    /** UTC hour bucket {@code YYYY-MM-DDTHH}. */
    public static String utcHour(Instant instant) {
        return HOUR.format(instant);
    }

    /** Like JavaScript's toUTCString: {@code Sat, 03 Oct 2026 12:00:00 GMT}. */
    public static String httpDate(Instant instant) {
        return HTTP_DATE.format(instant);
    }
}
