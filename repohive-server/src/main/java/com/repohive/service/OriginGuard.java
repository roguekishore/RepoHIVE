package com.repohive.service;

import com.repohive.config.AppConfig;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

/** State-changing requests must carry an Origin equal to the configured site origin. */
@Component
public class OriginGuard {

    private final String siteOrigin;

    public OriginGuard(AppConfig config) {
        this.siteOrigin = config.siteOrigin();
    }

    public boolean allows(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        return origin != null && origin.equals(siteOrigin);
    }
}
