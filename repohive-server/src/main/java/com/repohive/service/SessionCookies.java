package com.repohive.service;

import com.repohive.config.AppConfig;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import org.springframework.stereotype.Component;

/** The session cookie, written by hand so the attributes match today's header byte for byte. */
@Component
public class SessionCookies {

    private final boolean hosted;

    public SessionCookies(AppConfig config) {
        this.hosted = config.hosted();
    }

    public String name() {
        return hosted ? "__Host-repohive_session" : "repohive_session";
    }

    /** The session token from the Cookie header, or null. */
    public String parse(HttpServletRequest request) {
        String header = request.getHeader("Cookie");
        if (header == null) {
            return null;
        }
        String prefix = name() + "=";
        for (String part : header.split(";")) {
            String trimmed = part.strip();
            if (trimmed.startsWith(prefix)) {
                return trimmed.substring(prefix.length());
            }
        }
        return null;
    }

    public String buildSet(String token, Instant expiresAt) {
        return name() + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Expires=" + TimeFormat.httpDate(expiresAt)
                + (hosted ? "; Secure" : "");
    }

    public String buildClear() {
        return name() + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + (hosted ? "; Secure" : "");
    }
}
