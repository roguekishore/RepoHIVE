package com.repohive.controller;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.repository.SettingsRepository.AuditRow;
import com.repohive.service.ClientIpResolver;
import com.repohive.service.RuntimeLimits;
import com.repohive.service.RuntimeLimits.Limit;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Read and change the runtime limits. Behind {@link AdminGate}; no session, no origin check: a browser page on an
 * allow-listed origin may call it cross-origin (AdminCorsConfiguration).
 */
@RestController
class AdminLimitsController {

    private static final ObjectMapper JSON = new ObjectMapper();
    static final String PATH = "/api/admin/limits";
    private static final int MAX_BODY_BYTES = 64 * 1024;
    private static final int RECENT_CHANGES = 20;

    record LimitBody(String key, int value, int defaultValue, boolean overridden, int min, int max) {}

    record ChangeBody(String key, int oldValue, int newValue) {}

    record AuditBody(String key, int oldValue, int newValue, String changedAt, String fromIp) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record LimitsBody(
            List<LimitBody> limits,
            List<ChangeBody> changes,
            List<String> clamped,
            AuditBody lastChange,
            List<AuditBody> recent) {}

    private final AdminGate gate;
    private final RuntimeLimits limits;
    private final ClientIpResolver clientIp;

    AdminLimitsController(AdminGate gate, RuntimeLimits limits, ClientIpResolver clientIp) {
        this.gate = gate;
        this.limits = limits;
        this.clientIp = clientIp;
    }

    @GetMapping(PATH)
    public void get(HttpServletRequest request, HttpServletResponse response) {
        if (gate.admit(request, response)) {
            JsonResponses.json(response, HttpStatus.OK, body(null, null));
        }
    }

    @PutMapping(PATH)
    public void put(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!gate.admit(request, response)) {
            return;
        }
        byte[] raw = request.getInputStream().readNBytes(MAX_BODY_BYTES + 1);
        if (raw.length > MAX_BODY_BYTES) {
            JsonResponses.error(response, HttpStatus.PAYLOAD_TOO_LARGE, "BODY_TOO_LARGE", "The request body is too large.");
            return;
        }
        Map<Limit, Integer> requested = new LinkedHashMap<>();
        String problem = parse(raw, requested);
        if (problem != null) {
            JsonResponses.error(response, HttpStatus.BAD_REQUEST, "BAD_REQUEST", problem);
            return;
        }
        RuntimeLimits.UpdateResult result = limits.update(requested, clientIp.resolve(request));
        JsonResponses.json(response, HttpStatus.OK, body(result.changes(), result.clamped()));
    }

    /** Fills requested from {"limits": {key: integer or null}}; the problem in words, or null when it is all valid. */
    private static String parse(byte[] raw, Map<Limit, Integer> requested) {
        JsonNode root;
        try {
            root = JSON.readTree(raw);
        } catch (IOException e) {
            return "The body is not valid JSON.";
        }
        JsonNode values = root == null ? null : root.get("limits");
        if (values == null || !values.isObject() || values.isEmpty()) {
            return "Expected {\"limits\": {<limit>: <integer or null>}} with at least one limit.";
        }
        for (Iterator<Map.Entry<String, JsonNode>> fields = values.fields(); fields.hasNext(); ) {
            Map.Entry<String, JsonNode> field = fields.next();
            Limit limit = Limit.byKey(field.getKey()).orElse(null);
            if (limit == null) {
                return "Unknown limit: " + field.getKey() + ".";
            }
            JsonNode value = field.getValue();
            if (value.isNull()) {
                requested.put(limit, null);
                continue;
            }
            if (!value.isIntegralNumber() || !value.canConvertToLong()) {
                return field.getKey() + " must be a whole number, or null for the default.";
            }
            if (value.asLong() < RuntimeLimits.MIN) {
                return field.getKey() + " must be at least " + RuntimeLimits.MIN + ".";
            }
            requested.put(limit, (int) Math.min(value.asLong(), Integer.MAX_VALUE));
        }
        return null;
    }

    private LimitsBody body(List<RuntimeLimits.Change> changes, List<Limit> clamped) {
        List<LimitBody> entries = new ArrayList<>();
        for (RuntimeLimits.Entry e : limits.entries()) {
            entries.add(new LimitBody(
                    e.limit().key(), e.value(), e.defaultValue(), e.overridden(), RuntimeLimits.MIN, e.limit().max()));
        }
        List<AuditBody> recent = new ArrayList<>();
        for (AuditRow row : limits.recentChanges(RECENT_CHANGES)) {
            recent.add(new AuditBody(row.key(), row.oldValue(), row.newValue(), row.changedAt(), row.changedFromIp()));
        }
        return new LimitsBody(
                entries,
                changes == null ? null : changes.stream().map(c -> new ChangeBody(c.limit().key(), c.oldValue(), c.newValue())).toList(),
                clamped == null ? null : clamped.stream().map(Limit::key).toList(),
                recent.isEmpty() ? null : recent.get(0),
                recent);
    }
}
