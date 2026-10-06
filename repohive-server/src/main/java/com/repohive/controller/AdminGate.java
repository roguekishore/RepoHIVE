package com.repohive.controller;

import com.repohive.config.AppConfig;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * The admin API's one door: a bearer token of its own (not the worker's secret), compared in constant time. With no
 * token configured the whole API answers 404, as if it did not exist.
 */
@Component
class AdminGate {

    private final byte[] tokenDigest;

    AdminGate(AppConfig config) {
        this.tokenDigest = config.adminToken() == null ? null : sha256(config.adminToken());
    }

    private static byte[] sha256(String text) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private boolean authorized(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            return false;
        }
        return MessageDigest.isEqual(sha256(header.substring("Bearer ".length())), tokenDigest);
    }

    /** True when the request may go on; otherwise the response has been written. */
    boolean admit(HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        if (tokenDigest == null) {
            JsonResponses.error(response, HttpStatus.NOT_FOUND, "NOT_FOUND", "Not found.");
            return false;
        }
        if (!authorized(request)) {
            response.setHeader("WWW-Authenticate", "Bearer");
            JsonResponses.error(response, HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Unauthorized.");
            return false;
        }
        return true;
    }
}
