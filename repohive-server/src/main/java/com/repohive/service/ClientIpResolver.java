package com.repohive.service;

import com.repohive.config.AppConfig;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

/**
 * Hosted: the configured header, else 0.0.0.0. Local: first X-Forwarded-For entry, then X-Real-IP, then
 * 127.0.0.1. The socket address is not used, for parity with today's server.
 */
@Component
public class ClientIpResolver {

    private final AppConfig config;

    public ClientIpResolver(AppConfig config) {
        this.config = config;
    }

    public String resolve(HttpServletRequest request) {
        if (config.hosted()) {
            String header = config.clientIpHeader();
            if (header == null) {
                return "0.0.0.0";
            }
            String value = request.getHeader(header);
            return value == null || value.strip().isEmpty() ? "0.0.0.0" : value.strip();
        }
        String forwarded = request.getHeader("x-forwarded-for");
        if (forwarded != null && !forwarded.isEmpty()) {
            String first = forwarded.split(",", -1)[0].strip();
            if (!first.isEmpty()) {
                return first;
            }
        }
        String real = request.getHeader("x-real-ip");
        if (real != null && !real.strip().isEmpty()) {
            return real.strip();
        }
        return "127.0.0.1";
    }
}
