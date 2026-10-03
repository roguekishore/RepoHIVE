package com.repohive.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Consumer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** One CloudWatch EMF JSON line per metric, written to stdout (port of telemetry/app-metrics.ts). */
@Component
public class MetricsEmitter {

    public static final String NAMESPACE = "RepoHIVE/Hosted";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Clock clock;
    private final Consumer<String> writer;

    @Autowired
    public MetricsEmitter(Clock clock) {
        this(clock, line -> System.out.println(line));
    }

    public MetricsEmitter(Clock clock, Consumer<String> writer) {
        this.clock = clock;
        this.writer = writer;
    }

    public void jobsAccepted() {
        emit("JobsAccepted", 1, Map.of());
    }

    public void jobsCacheHit() {
        emit("JobsCacheHit", 1, Map.of());
    }

    public void jobsJoined() {
        emit("JobsJoined", 1, Map.of());
    }

    public void jobsRejected(String reason) {
        emit("JobsRejected", 1, Map.of("Reason", sanitizeReason(reason)));
    }

    public void signUp() {
        emit("SignUps", 1, Map.of());
    }

    public void inFlight(long count) {
        emit("InFlight", Math.max(0, count), Map.of());
    }

    static String sanitizeReason(String reason) {
        String trimmed = reason.strip();
        if (trimmed.isEmpty()) {
            return "UNKNOWN";
        }
        String cleaned = trimmed.replaceAll("[^A-Za-z0-9_]", "_");
        if (cleaned.length() > 64) {
            cleaned = cleaned.substring(0, 64);
        }
        return cleaned.toUpperCase(Locale.ROOT);
    }

    private void emit(String name, long value, Map<String, String> extra) {
        Map<String, String> dimensions = new LinkedHashMap<>();
        dimensions.put("Component", "app");
        dimensions.putAll(extra);

        Map<String, Object> metricsBlock = new LinkedHashMap<>();
        metricsBlock.put("Namespace", NAMESPACE);
        metricsBlock.put("Dimensions", List.of(List.copyOf(dimensions.keySet())));
        Map<String, String> metric = new LinkedHashMap<>();
        metric.put("Name", name);
        metric.put("Unit", "Count");
        metricsBlock.put("Metrics", List.of(metric));
        Map<String, Object> aws = new LinkedHashMap<>();
        aws.put("Timestamp", clock.millis());
        aws.put("CloudWatchMetrics", List.of(metricsBlock));

        Map<String, Object> line = new LinkedHashMap<>();
        line.put("_aws", aws);
        line.putAll(dimensions);
        line.put(name, value);
        try {
            writer.accept(JSON.writeValueAsString(line));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }
}
