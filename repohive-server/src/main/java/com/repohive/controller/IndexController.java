package com.repohive.controller;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.model.ActiveSession;
import com.repohive.service.AccountService;
import com.repohive.service.ClientIpResolver;
import com.repohive.service.IntakeService;
import com.repohive.service.OriginGuard;
import com.repohive.service.PrecheckFailedException;
import com.repohive.service.SessionCookies;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** POST /api/index. */
@RestController
public class IndexController {

    private static final Logger LOG = LoggerFactory.getLogger(IndexController.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record IndexBody(String status, String repo, String snapshotId, String jobId, String code, String message, Integer retryAfterSeconds) {}

    private final OriginGuard origin;
    private final AccountService accounts;
    private final SessionCookies cookies;
    private final ClientIpResolver clientIp;
    private final IntakeService intake;

    public IndexController(
            OriginGuard origin, AccountService accounts, SessionCookies cookies, ClientIpResolver clientIp, IntakeService intake) {
        this.origin = origin;
        this.accounts = accounts;
        this.cookies = cookies;
        this.clientIp = clientIp;
        this.intake = intake;
    }

    @PostMapping("/api/index")
    public void index(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!origin.allows(request)) {
            JsonResponses.originRejected(response);
            return;
        }
        Optional<String> repo = readRepo(request);
        if (repo.isEmpty()) {
            JsonResponses.error(response, HttpStatus.BAD_REQUEST, "BAD_REQUEST", "Expected a repository reference.");
            return;
        }
        Optional<ActiveSession> session = accounts.resolveSession(cookies.parse(request));
        if (session.isEmpty()) {
            JsonResponses.error(response, HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "Sign in to request an index.");
            return;
        }
        IntakeService.Outcome outcome;
        try {
            outcome = intake.process(session.get().accountId(), clientIp.resolve(request), repo.get());
        } catch (PrecheckFailedException e) {
            LOG.error("pre-check failed: {}", e.getMessage());
            JsonResponses.error(response, HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "The request could not be processed.");
            return;
        }
        switch (outcome) {
            case IntakeService.Outcome.Cached c -> JsonResponses.json(response, HttpStatus.OK,
                    new IndexBody("cached", c.repo(), c.snapshotId(), null, null, null, null));
            case IntakeService.Outcome.Joined j -> JsonResponses.json(response, HttpStatus.OK,
                    new IndexBody("joined", null, null, j.jobId(), null, null, null));
            case IntakeService.Outcome.Accepted a -> JsonResponses.json(response, HttpStatus.ACCEPTED,
                    new IndexBody("accepted", null, null, a.jobId(), null, null, null));
            case IntakeService.Outcome.Busy b -> {
                response.setHeader("Retry-After", String.valueOf(b.retryAfterSeconds()));
                JsonResponses.json(response, HttpStatus.SERVICE_UNAVAILABLE,
                        new IndexBody("busy", null, null, null, null, null, b.retryAfterSeconds()));
            }
            case IntakeService.Outcome.Rejected r -> JsonResponses.json(response, HttpStatus.valueOf(r.httpStatus()),
                    new IndexBody("rejected", null, null, null, r.code(), r.message(), null));
        }
    }

    private static Optional<String> readRepo(HttpServletRequest request) throws IOException {
        JsonNode node;
        try {
            node = JSON.readTree(request.getInputStream().readAllBytes());
        } catch (IOException e) {
            return Optional.empty();
        }
        if (node == null || !node.isObject() || !node.path("repo").isTextual() || node.get("repo").asText().isBlank()) {
            return Optional.empty();
        }
        return Optional.of(node.get("repo").asText().strip());
    }
}
