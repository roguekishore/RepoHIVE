package com.repohive.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;

/** JSON responses written straight to the servlet response. Errors are {"code","message"}. */
final class JsonResponses {

    static final String CONTENT_TYPE = "application/json; charset=utf-8";
    private static final ObjectMapper JSON = new ObjectMapper();

    record ErrorBody(String code, String message) {}

    record OkBody(boolean ok) {}

    private JsonResponses() {}

    static void json(HttpServletResponse response, HttpStatus status, Object body, String... setCookies) {
        byte[] bytes;
        try {
            bytes = JSON.writeValueAsString(body).getBytes(StandardCharsets.UTF_8);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
        response.setStatus(status.value());
        response.setHeader(HttpHeaders.CONTENT_TYPE, CONTENT_TYPE);
        for (String cookie : setCookies) {
            response.addHeader(HttpHeaders.SET_COOKIE, cookie);
        }
        response.setContentLength(bytes.length);
        try {
            response.getOutputStream().write(bytes);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static void error(HttpServletResponse response, HttpStatus status, String code, String message) {
        json(response, status, new ErrorBody(code, message));
    }

    static void originRejected(HttpServletResponse response) {
        error(response, HttpStatus.FORBIDDEN, "ORIGIN_REJECTED", "Origin not allowed.");
    }
}
