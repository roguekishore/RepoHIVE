package com.repohive.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.model.AccountRecord;
import com.repohive.repository.BenchRepository.Active;
import com.repohive.repository.BenchRepository.AuditRow;
import com.repohive.repository.BenchRepository.Found;
import com.repohive.service.BenchAccounts;
import com.repohive.service.ClientIpResolver;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Flag an account for benchmarking for a number of hours, and see or end the flags. Behind {@link AdminGate}. A
 * flagged account is not held to the quotas, the per-IP limits, one index at a time or the global in-flight cap
 * (see {@link BenchAccounts}); the flag ends by itself.
 */
@RestController
class AdminBenchController {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PATH = "/api/admin/bench";
    private static final int MAX_BODY_BYTES = 4 * 1024;
    private static final int MAX_EMAIL_LENGTH = 320;
    private static final int RECENT_CHANGES = 20;

    record ActiveBody(String accountId, String email, String enabledAt, String expiresAt) {}

    record AuditBody(String email, String action, String expiresAt, String changedAt, String fromIp) {}

    record BenchBody(List<ActiveBody> active, int maxHours, int defaultHours, List<AuditBody> recent) {}

    record FoundBody(String accountId, String email, String benchUntil) {}

    record AccountsBody(List<FoundBody> accounts) {}

    private final AdminGate gate;
    private final BenchAccounts bench;
    private final ClientIpResolver clientIp;

    AdminBenchController(AdminGate gate, BenchAccounts bench, ClientIpResolver clientIp) {
        this.gate = gate;
        this.bench = bench;
        this.clientIp = clientIp;
    }

    @GetMapping(PATH)
    public void list(HttpServletRequest request, HttpServletResponse response) {
        if (gate.admit(request, response)) {
            JsonResponses.json(response, HttpStatus.OK, body());
        }
    }

    /** Accounts whose email contains q (the newest twenty when q is empty), with their flag if any. */
    @GetMapping(PATH + "/accounts")
    public void accounts(
            @RequestParam(name = "q", defaultValue = "") String q, HttpServletRequest request, HttpServletResponse response) {
        if (!gate.admit(request, response)) {
            return;
        }
        String text = q.strip();
        if (text.length() > MAX_EMAIL_LENGTH) {
            JsonResponses.error(response, HttpStatus.BAD_REQUEST, "BAD_REQUEST", "The search text is too long.");
            return;
        }
        List<FoundBody> found = bench.search(text).stream().map(AdminBenchController::found).toList();
        JsonResponses.json(response, HttpStatus.OK, new AccountsBody(found));
    }

    /** Body {"email": "...", "hours": 1..72}; hours defaults to 12. Flagging again replaces the end time. */
    @PutMapping(PATH)
    public void enable(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!gate.admit(request, response)) {
            return;
        }
        byte[] raw = request.getInputStream().readNBytes(MAX_BODY_BYTES + 1);
        if (raw.length > MAX_BODY_BYTES) {
            JsonResponses.error(response, HttpStatus.PAYLOAD_TOO_LARGE, "BODY_TOO_LARGE", "The request body is too large.");
            return;
        }
        JsonNode root;
        try {
            root = JSON.readTree(raw);
        } catch (IOException e) {
            root = null;
        }
        if (root == null || !root.path("email").isTextual() || root.get("email").asText().isBlank()
                || root.get("email").asText().length() > MAX_EMAIL_LENGTH) {
            JsonResponses.error(response, HttpStatus.BAD_REQUEST, "BAD_REQUEST", "Expected {\"email\": \"...\", \"hours\": 1 to "
                    + BenchAccounts.MAX_HOURS + "}.");
            return;
        }
        int hours = BenchAccounts.DEFAULT_HOURS;
        if (root.hasNonNull("hours")) {
            JsonNode value = root.get("hours");
            if (!value.isIntegralNumber() || !value.canConvertToInt() || value.asInt() < 1 || value.asInt() > BenchAccounts.MAX_HOURS) {
                JsonResponses.error(response, HttpStatus.BAD_REQUEST, "BAD_REQUEST",
                        "hours must be a whole number from 1 to " + BenchAccounts.MAX_HOURS + ".");
                return;
            }
            hours = value.asInt();
        }
        Optional<AccountRecord> account = bench.findAccount(root.get("email").asText());
        if (account.isEmpty()) {
            notFound(response);
            return;
        }
        bench.enable(account.get(), hours, clientIp.resolve(request));
        JsonResponses.json(response, HttpStatus.OK, body());
    }

    /** Ends the flag at once. Idempotent: an account with no flag is answered the same way. */
    @DeleteMapping(PATH)
    public void disable(@RequestParam(name = "email", defaultValue = "") String email, HttpServletRequest request,
            HttpServletResponse response) {
        if (!gate.admit(request, response)) {
            return;
        }
        Optional<AccountRecord> account = email.length() > MAX_EMAIL_LENGTH ? Optional.empty() : bench.findAccount(email);
        if (account.isEmpty()) {
            notFound(response);
            return;
        }
        bench.disable(account.get(), clientIp.resolve(request));
        JsonResponses.json(response, HttpStatus.OK, body());
    }

    private static void notFound(HttpServletResponse response) {
        JsonResponses.error(response, HttpStatus.NOT_FOUND, "ACCOUNT_NOT_FOUND", "No account has that email address.");
    }

    private static FoundBody found(Found f) {
        return new FoundBody(f.accountId(), f.email(), f.benchUntil());
    }

    private BenchBody body() {
        List<ActiveBody> active = bench.active().stream().map(AdminBenchController::activeBody).toList();
        List<AuditBody> recent = bench.recent(RECENT_CHANGES).stream().map(AdminBenchController::auditBody).toList();
        return new BenchBody(active, BenchAccounts.MAX_HOURS, BenchAccounts.DEFAULT_HOURS, recent);
    }

    private static ActiveBody activeBody(Active a) {
        return new ActiveBody(a.accountId(), a.email(), a.enabledAt(), a.expiresAt());
    }

    private static AuditBody auditBody(AuditRow r) {
        return new AuditBody(r.email(), r.action(), r.expiresAt(), r.changedAt(), r.changedFromIp());
    }
}
