package com.repohive.controller;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.model.ActiveSession;
import com.repohive.model.AuthOutcome;
import com.repohive.model.AuthRejectCode;
import com.repohive.service.AccountService;
import com.repohive.service.ClientIpResolver;
import com.repohive.service.MetricsEmitter;
import com.repohive.service.OriginGuard;
import com.repohive.service.SessionCookies;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** Sign-up, sign-in, sign-out and the session probe. */
@RestController
public class AuthController {

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record SessionBody(boolean signedIn, String email) {}

    private record Credentials(String email, String password) {}

    private static final ObjectMapper JSON = new ObjectMapper();

    private final AccountService accounts;
    private final SessionCookies cookies;
    private final ClientIpResolver clientIp;
    private final OriginGuard origin;
    private final MetricsEmitter metrics;

    public AuthController(
            AccountService accounts, SessionCookies cookies, ClientIpResolver clientIp, OriginGuard origin, MetricsEmitter metrics) {
        this.accounts = accounts;
        this.cookies = cookies;
        this.clientIp = clientIp;
        this.origin = origin;
        this.metrics = metrics;
    }

    @PostMapping("/api/auth/sign-up")
    public void signUp(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!origin.allows(request)) {
            JsonResponses.originRejected(response);
            return;
        }
        Optional<Credentials> body = readCredentials(request);
        if (body.isEmpty()) {
            badRequest(response);
            return;
        }
        AuthOutcome result = accounts.signUp(clientIp.resolve(request), body.get().email(), body.get().password());
        if (result instanceof AuthOutcome.Rejected rejected) {
            HttpStatus status = switch (rejected.code()) {
                case SIGNUP_IP_LIMIT -> HttpStatus.TOO_MANY_REQUESTS;
                case EMAIL_TAKEN -> HttpStatus.CONFLICT;
                default -> HttpStatus.BAD_REQUEST;
            };
            JsonResponses.error(response, status, rejected.code().name(), rejected.message());
            return;
        }
        var grant = ((AuthOutcome.Granted) result).grant();
        metrics.signUp();
        JsonResponses.json(response, HttpStatus.CREATED, new JsonResponses.OkBody(true), cookies.buildSet(grant.sessionToken(), grant.expiresAt()));
    }

    @PostMapping("/api/auth/sign-in")
    public void signIn(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!origin.allows(request)) {
            JsonResponses.originRejected(response);
            return;
        }
        Optional<Credentials> body = readCredentials(request);
        if (body.isEmpty()) {
            badRequest(response);
            return;
        }
        AuthOutcome result = accounts.signIn(clientIp.resolve(request), body.get().email(), body.get().password());
        if (result instanceof AuthOutcome.Rejected rejected) {
            HttpStatus status = rejected.code() == AuthRejectCode.SIGNIN_LOCKED ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.UNAUTHORIZED;
            JsonResponses.error(response, status, rejected.code().name(), rejected.message());
            return;
        }
        var grant = ((AuthOutcome.Granted) result).grant();
        JsonResponses.json(response, HttpStatus.OK, new JsonResponses.OkBody(true), cookies.buildSet(grant.sessionToken(), grant.expiresAt()));
    }

    @PostMapping("/api/auth/sign-out")
    public void signOut(HttpServletRequest request, HttpServletResponse response) {
        if (!origin.allows(request)) {
            JsonResponses.originRejected(response);
            return;
        }
        accounts.signOut(cookies.parse(request));
        JsonResponses.json(response, HttpStatus.OK, new JsonResponses.OkBody(true), cookies.buildClear());
    }

    @GetMapping("/api/auth/session")
    public void session(HttpServletRequest request, HttpServletResponse response) {
        Optional<ActiveSession> session = accounts.resolveSession(cookies.parse(request));
        JsonResponses.json(response, HttpStatus.OK,
                session.map(s -> new SessionBody(true, s.email())).orElseGet(() -> new SessionBody(false, null)));
    }

    private static void badRequest(HttpServletResponse response) {
        JsonResponses.error(response, HttpStatus.BAD_REQUEST, "BAD_REQUEST", "Expected email and password.");
    }

    /** The body when it is a JSON object with string email and password; otherwise empty. */
    private static Optional<Credentials> readCredentials(HttpServletRequest request) throws IOException {
        JsonNode node;
        try {
            node = JSON.readTree(request.getInputStream().readAllBytes());
        } catch (IOException e) {
            return Optional.empty();
        }
        if (node == null || !node.isObject() || !node.path("email").isTextual() || !node.path("password").isTextual()) {
            return Optional.empty();
        }
        return Optional.of(new Credentials(node.get("email").asText(), node.get("password").asText()));
    }
}
