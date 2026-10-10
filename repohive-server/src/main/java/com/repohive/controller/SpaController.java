package com.repohive.controller;

import com.repohive.config.AppConfig;
import com.repohive.service.SpaService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Local mode with REPOHIVE_WEB_DIR set: the exported SPA for every GET the server does not own. */
@RestController
public class SpaController {

    private final SpaService spa;

    public SpaController(AppConfig config) {
        this.spa = !config.hosted() && config.webDir() != null ? new SpaService(config.webDir()) : null;
    }

    @GetMapping("/**")
    public void page(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String uri = request.getRequestURI();
        String context = request.getContextPath();
        String path = context.isEmpty() ? uri : uri.substring(context.length());
        if (spa == null || SpaService.isServerPath(path)) {
            JsonResponses.error(response, HttpStatus.NOT_FOUND, "NOT_FOUND", "Not found.");
            return;
        }
        boolean payload = "1".equals(request.getHeader("RSC")) || request.getParameter("_rsc") != null;
        Optional<SpaService.Page> page = spa.resolve(path, payload);
        if (page.isEmpty()) {
            JsonResponses.error(response, HttpStatus.NOT_FOUND, "NOT_FOUND", "Not found.");
            return;
        }
        SpaService.Page found = page.get();
        byte[] body = Files.readAllBytes(found.file());
        response.setStatus(found.status());
        response.setHeader("Content-Type", found.contentType());
        if (found.cacheControl() != null) {
            response.setHeader("Cache-Control", found.cacheControl());
        }
        response.setContentLength(body.length);
        response.getOutputStream().write(body);
    }
}
