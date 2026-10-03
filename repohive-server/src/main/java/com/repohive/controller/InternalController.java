package com.repohive.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.config.AppConfig;
import com.repohive.model.IndexedRepo;
import com.repohive.model.JobStates;
import com.repohive.model.Tiers;
import com.repohive.repository.IndexedRepoRepository;
import com.repohive.service.JobService;
import com.repohive.service.RepoNames;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** The worker's channel to the server. Bearer secret only: no origin check, no session. */
@RestController
public class InternalController {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final byte[] secret;
    private final JobService jobs;
    private final IndexedRepoRepository repos;

    public InternalController(AppConfig config, JobService jobs, IndexedRepoRepository repos) {
        this.secret = config.internalSecret().getBytes(StandardCharsets.UTF_8);
        this.jobs = jobs;
        this.repos = repos;
    }

    private boolean authorized(HttpServletRequest request, HttpServletResponse response) {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")
                && MessageDigest.isEqual(header.substring("Bearer ".length()).getBytes(StandardCharsets.UTF_8), secret)) {
            return true;
        }
        JsonResponses.error(response, HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Unauthorized.");
        return false;
    }

    private static JsonNode body(HttpServletRequest request) throws IOException {
        try {
            JsonNode node = JSON.readTree(request.getInputStream().readAllBytes());
            return node != null && node.isObject() ? node : null;
        } catch (IOException e) {
            return null;
        }
    }

    private static void bad(HttpServletResponse response, String message) {
        JsonResponses.error(response, HttpStatus.BAD_REQUEST, "BAD_REQUEST", message);
    }

    private static Integer optionalCount(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isIntegralNumber() && value.asLong() >= 0 ? value.asInt() : null;
    }

    private static void finish(HttpServletResponse response, JobService.ReportResult result) {
        switch (result.kind()) {
            case OK -> response.setStatus(HttpStatus.NO_CONTENT.value());
            case NOT_FOUND -> JsonResponses.error(response, HttpStatus.NOT_FOUND, "NOT_FOUND", "Unknown job.");
            case NOT_OPEN -> JsonResponses.error(response, HttpStatus.CONFLICT, "JOB_NOT_OPEN", "The job has already ended.");
            case BAD_REQUEST -> bad(response, result.message());
        }
    }

    @PostMapping("/api/internal/jobs/progress")
    public void progress(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!authorized(request, response)) {
            return;
        }
        JsonNode node = body(request);
        if (node == null || !node.path("jobId").isTextual() || node.get("jobId").asText().isEmpty()) {
            bad(response, "Expected a jobId.");
            return;
        }
        String state = null;
        if (node.hasNonNull("state")) {
            if (!node.get("state").isTextual() || !JobStates.isKnown(node.get("state").asText())) {
                bad(response, "Unknown state.");
                return;
            }
            state = node.get("state").asText();
        }
        JobService.Progress progress = null;
        if (node.hasNonNull("progress")) {
            JsonNode p = node.get("progress");
            if (!p.isObject() || !p.path("stage").isTextual()) {
                bad(response, "Malformed progress.");
                return;
            }
            progress = new JobService.Progress(p.get("stage").asText(), optionalCount(p, "completed"), optionalCount(p, "total"));
        }
        finish(response, jobs.progress(node.get("jobId").asText(), state, progress));
    }

    @PostMapping("/api/internal/jobs/complete")
    public void complete(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!authorized(request, response)) {
            return;
        }
        JsonNode node = body(request);
        if (node == null || !node.path("jobId").isTextual() || !node.path("status").isTextual()) {
            bad(response, "Expected a jobId and status.");
            return;
        }
        String jobId = node.get("jobId").asText();
        JobService.Completion completion;
        switch (node.get("status").asText()) {
            case "succeeded" -> {
                Integer nodes = optionalCount(node, "nodeCount");
                Integer edges = optionalCount(node, "edgeCount");
                if (!node.path("snapshotId").isTextual() || nodes == null || edges == null) {
                    bad(response, "Expected snapshotId, nodeCount and edgeCount.");
                    return;
                }
                completion = new JobService.Completion.Succeeded(
                        node.get("snapshotId").asText(),
                        node.path("commitSha").isTextual() ? node.get("commitSha").asText() : null,
                        node.path("engineVersion").isTextual() ? node.get("engineVersion").asText() : null,
                        node.path("viewsVersion").isTextual() ? node.get("viewsVersion").asText() : null,
                        nodes, edges);
            }
            case "failed" -> {
                String cls = node.path("failureClass").asText("");
                if ((!cls.equals("user") && !cls.equals("system")) || !node.path("failureCode").isTextual()
                        || node.get("failureCode").asText().isEmpty()) {
                    bad(response, "Expected failureClass (user or system) and failureCode.");
                    return;
                }
                completion = new JobService.Completion.Failed(cls, node.get("failureCode").asText(), node.path("message").asText(""));
            }
            case "retier" -> {
                if (!node.path("tier").isTextual() || !Tiers.isValid(node.get("tier").asText())) {
                    bad(response, "Expected a tier.");
                    return;
                }
                completion = new JobService.Completion.Retier(node.get("tier").asText());
            }
            default -> {
                bad(response, "Unknown status.");
                return;
            }
        }
        finish(response, jobs.complete(jobId, completion));
    }

    @GetMapping("/api/internal/repos/{owner}/{repo:.+}/active")
    public void active(@PathVariable String owner, @PathVariable String repo, HttpServletRequest request, HttpServletResponse response) {
        if (!authorized(request, response)) {
            return;
        }
        Optional<IndexedRepo> found = RepoNames.repoKey(owner, repo).flatMap(repos::find);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("snapshotId", found.map(IndexedRepo::snapshotId).orElse(null));
        JsonResponses.json(response, HttpStatus.OK, body);
    }
}
