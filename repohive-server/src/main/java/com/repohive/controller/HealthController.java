package com.repohive.controller;

import com.repohive.model.HealthReport;
import com.repohive.service.HealthService;
import org.springframework.http.HttpStatus;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    private final HealthService health;

    public HealthController(HealthService health) {
        this.health = health;
    }

    /** Unauthenticated: 200 when ok, 503 when degraded, the report as the body either way. */
    @GetMapping("/healthz")
    public void healthz(HttpServletResponse response) {
        HealthReport report = health.check();
        HttpStatus status = "ok".equals(report.status()) ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
        JsonResponses.json(response, status, report);
    }
}
