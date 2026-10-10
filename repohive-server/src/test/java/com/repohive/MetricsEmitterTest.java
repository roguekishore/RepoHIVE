package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.service.MetricsEmitter;
import com.repohive.support.TestClock;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class MetricsEmitterTest {

    private final ObjectMapper json = new ObjectMapper();
    private final List<String> lines = new ArrayList<>();
    private final MetricsEmitter metrics = new MetricsEmitter(new TestClock(), lines::add);

    @Test
    void signUpIsOneEmfLine() throws Exception {
        metrics.signUp();
        assertThat(lines).hasSize(1);
        JsonNode line = json.readTree(lines.get(0));
        assertThat(line.at("/_aws/Timestamp").asLong()).isEqualTo(TestClock.START.toEpochMilli());
        assertThat(line.at("/_aws/CloudWatchMetrics/0/Namespace").asText()).isEqualTo("RepoHIVE/Hosted");
        assertThat(line.at("/_aws/CloudWatchMetrics/0/Dimensions/0/0").asText()).isEqualTo("Component");
        assertThat(line.at("/_aws/CloudWatchMetrics/0/Metrics/0/Name").asText()).isEqualTo("SignUps");
        assertThat(line.at("/_aws/CloudWatchMetrics/0/Metrics/0/Unit").asText()).isEqualTo("Count");
        assertThat(line.get("Component").asText()).isEqualTo("app");
        assertThat(line.get("SignUps").asInt()).isEqualTo(1);
    }

    @Test
    void rejectionsCarryASanitisedReasonDimension() throws Exception {
        metrics.jobsRejected("quota account!");
        JsonNode line = json.readTree(lines.get(0));
        assertThat(line.at("/_aws/CloudWatchMetrics/0/Dimensions/0").toString()).isEqualTo("[\"Component\",\"Reason\"]");
        assertThat(line.get("Reason").asText()).isEqualTo("QUOTA_ACCOUNT_");
        assertThat(line.get("JobsRejected").asInt()).isEqualTo(1);
    }

    @Test
    void inFlightIsClampedAtZeroAndOtherCountersExist() throws Exception {
        metrics.inFlight(-3);
        metrics.jobsAccepted();
        metrics.jobsCacheHit();
        metrics.jobsJoined();
        metrics.jobsRejected("   ");
        assertThat(json.readTree(lines.get(0)).get("InFlight").asInt()).isZero();
        assertThat(lines.get(1)).contains("\"JobsAccepted\":1");
        assertThat(lines.get(2)).contains("\"JobsCacheHit\":1");
        assertThat(lines.get(3)).contains("\"JobsJoined\":1");
        assertThat(lines.get(4)).contains("\"Reason\":\"UNKNOWN\"");
    }
}
