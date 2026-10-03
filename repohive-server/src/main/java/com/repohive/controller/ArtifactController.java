package com.repohive.controller;

import com.repohive.service.ArtifactService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Optional;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** GET /artifacts/**: the local store's artifacts/ prefix, local mode only. */
@RestController
public class ArtifactController {

    private static final String PREFIX = "/artifacts";

    private final ArtifactService artifacts;

    public ArtifactController(ArtifactService artifacts) {
        this.artifacts = artifacts;
    }

    @GetMapping("/artifacts/**")
    public void artifact(HttpServletRequest request, HttpServletResponse response) {
        String uri = request.getRequestURI();
        String context = request.getContextPath();
        String path = context.isEmpty() ? uri : uri.substring(context.length());
        String rest = path.length() > PREFIX.length() ? path.substring(PREFIX.length() + 1) : "";
        Optional<ArtifactService.Served> served = artifacts.find(rest, request.getHeader("Accept-Encoding"));
        if (served.isEmpty()) {
            JsonResponses.error(response, HttpStatus.NOT_FOUND, "NOT_FOUND", "Not found.");
            return;
        }
        ArtifactService.Served object = served.get();
        response.setStatus(HttpStatus.OK.value());
        response.setHeader(HttpHeaders.CONTENT_TYPE, object.contentType());
        response.setHeader(HttpHeaders.VARY, "Accept-Encoding");
        if (object.cacheControl() != null) {
            response.setHeader(HttpHeaders.CACHE_CONTROL, object.cacheControl());
        }
        if (object.brotli()) {
            response.setHeader(HttpHeaders.CONTENT_ENCODING, "br");
        }
        response.setContentLength(object.body().length);
        try {
            response.getOutputStream().write(object.body());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
