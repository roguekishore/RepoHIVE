package com.repohive.controller;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.model.JobRow;
import com.repohive.model.JobStates;
import com.repohive.repository.JobRepository;
import com.repohive.service.ClientIpResolver;
import com.repohive.service.StreamRegistry;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** Job status and its progress stream. Public, as before. */
@RestController
public class JobController {

    private static final ObjectMapper JSON = new ObjectMapper();

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record ProgressBody(String stage, Integer completed, Integer total) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record ResultBody(String snapshotId) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record FailureBody(String code, String message) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record PublicJob(String repo, String state, ProgressBody progress, ResultBody result, FailureBody failure) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record EventFailure(String code) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record EventData(String jobId, String repo, String state, ProgressBody progress, ResultBody result, EventFailure failure) {}

    private final JobRepository jobs;
    private final ClientIpResolver clientIp;
    private final StreamRegistry streams;
    private final long pollMs;
    private final long heartbeatMs;
    private final long maxMs;

    public JobController(
            JobRepository jobs,
            ClientIpResolver clientIp,
            StreamRegistry streams,
            @Value("${repohive.sse.poll-ms:1000}") long pollMs,
            @Value("${repohive.sse.heartbeat-ms:15000}") long heartbeatMs,
            @Value("${repohive.sse.max-ms:1200000}") long maxMs) {
        this.jobs = jobs;
        this.clientIp = clientIp;
        this.streams = streams;
        this.pollMs = pollMs;
        this.heartbeatMs = heartbeatMs;
        this.maxMs = maxMs;
    }

    private static ProgressBody progressOf(JobRow job) {
        return job.progressStage() == null ? null : new ProgressBody(job.progressStage(), job.progressCompleted(), job.progressTotal());
    }

    @GetMapping("/api/jobs/{jobId}")
    public void status(@PathVariable String jobId, HttpServletResponse response) {
        Optional<JobRow> found = jobs.find(jobId);
        if (found.isEmpty()) {
            JsonResponses.error(response, HttpStatus.NOT_FOUND, "NOT_FOUND", "Unknown job.");
            return;
        }
        JobRow job = found.get();
        ResultBody result = "succeeded".equals(job.state()) ? new ResultBody(job.snapshotId()) : null;
        FailureBody failure = null;
        if ("failed".equals(job.state())) {
            failure = job.failureCode() != null
                    ? new FailureBody(job.failureCode(), job.failureCode())
                    : new FailureBody("FAILED", "The index failed.");
        }
        JsonResponses.json(response, HttpStatus.OK, new PublicJob(job.repo(), job.state(), progressOf(job), result, failure));
    }

    private static byte[] frame(int id, String event, EventData data) {
        try {
            return ("id: " + id + "\nevent: " + event + "\ndata: " + JSON.writeValueAsString(data) + "\n\n")
                    .getBytes(StandardCharsets.UTF_8);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static long parseLastEventId(String header) {
        if (header == null || header.isBlank()) {
            return 0;
        }
        try {
            long parsed = Long.parseLong(header.strip());
            return parsed >= 0 ? parsed : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /**
     * Polls the job row (no connection is held between polls) and writes a frame per poll, as the old server did.
     * Runs on the request thread; a closed connection surfaces as an IOException on the next write.
     */
    @GetMapping("/api/jobs/{jobId}/events")
    public void events(@PathVariable String jobId, HttpServletRequest request, HttpServletResponse response) throws IOException {
        String ip = clientIp.resolve(request);
        String streamId = UUID.randomUUID().toString();
        if (!streams.tryRegister(ip, streamId)) {
            JsonResponses.error(response, HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_STREAMS", "Too many open progress streams.");
            return;
        }
        try {
            response.setStatus(HttpStatus.OK.value());
            response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
            response.setHeader("Cache-Control", "no-cache, no-transform");
            response.setHeader("Connection", "keep-alive");
            response.flushBuffer();
            OutputStream out = response.getOutputStream();

            long lastSent = parseLastEventId(request.getHeader("Last-Event-ID"));
            int eventId = 0;
            long startedAt = System.currentTimeMillis();
            long nextPoll = startedAt;
            long nextHeartbeat = startedAt + heartbeatMs;
            while (true) {
                long now = System.currentTimeMillis();
                if (now >= nextPoll) {
                    if (now - startedAt >= maxMs) {
                        return;
                    }
                    nextPoll = now + pollMs;
                    Optional<JobRow> found = jobs.find(jobId);
                    eventId++;
                    boolean done;
                    byte[] bytes;
                    if (found.isEmpty()) {
                        bytes = frame(eventId, "done", new EventData(jobId, null, "failed", null, null, new EventFailure("NOT_FOUND")));
                        done = true;
                    } else {
                        JobRow job = found.get();
                        done = JobStates.isTerminal(job.state());
                        EventFailure failure = "failed".equals(job.state()) && job.failureCode() != null
                                ? new EventFailure(job.failureCode()) : null;
                        ResultBody result = "succeeded".equals(job.state()) ? new ResultBody(job.snapshotId()) : null;
                        bytes = frame(eventId, done ? "done" : "progress",
                                new EventData(jobId, job.repo(), job.state(), progressOf(job), result, failure));
                    }
                    if (eventId > lastSent) {
                        out.write(bytes);
                        out.flush();
                        lastSent = eventId;
                    }
                    if (done) {
                        return;
                    }
                }
                now = System.currentTimeMillis();
                if (now >= nextHeartbeat) {
                    nextHeartbeat = now + heartbeatMs;
                    out.write(": heartbeat\n\n".getBytes(StandardCharsets.UTF_8));
                    out.flush();
                }
                long wait = Math.min(nextPoll, nextHeartbeat) - System.currentTimeMillis();
                if (wait > 0) {
                    try {
                        Thread.sleep(wait);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                }
            }
        } catch (IOException e) {
            // The client went away.
        } finally {
            streams.unregister(ip, streamId);
        }
    }
}
