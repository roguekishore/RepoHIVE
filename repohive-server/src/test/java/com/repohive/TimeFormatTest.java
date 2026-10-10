package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.service.TimeFormat;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class TimeFormatTest {

    @Test
    void alwaysHasThreeFractionalDigitsEvenOnTheSecond() {
        assertThat(TimeFormat.iso(Instant.parse("2026-10-03T12:00:00Z"))).isEqualTo("2026-10-03T12:00:00.000Z");
        assertThat(TimeFormat.iso(Instant.parse("2026-10-03T12:00:00.120Z"))).isEqualTo("2026-10-03T12:00:00.120Z");
        assertThat(TimeFormat.iso(Instant.parse("2026-10-03T12:00:00.123456789Z"))).isEqualTo("2026-10-03T12:00:00.123Z");
    }

    @Test
    void stringOrderIsTimeOrder() {
        String a = TimeFormat.iso(Instant.parse("2026-10-03T12:00:00Z"));
        String b = TimeFormat.iso(Instant.parse("2026-10-03T12:00:00.001Z"));
        assertThat(a.compareTo(b)).isNegative();
    }

    @Test
    void dayHourAndHttpDate() {
        Instant t = Instant.parse("2026-11-02T05:06:07Z");
        assertThat(TimeFormat.utcDay(t)).isEqualTo("2026-11-02");
        assertThat(TimeFormat.utcHour(t)).isEqualTo("2026-11-02T05");
        assertThat(TimeFormat.httpDate(t)).isEqualTo("Mon, 02 Nov 2026 05:06:07 GMT");
    }
}
