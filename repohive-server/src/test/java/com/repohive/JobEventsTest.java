package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.service.StreamRegistry;
import com.repohive.support.Http;
import com.repohive.support.Seed;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@Timeout(60)
class JobEventsTest extends JobTestBase {

    @DynamicPropertySource
    static void sse(DynamicPropertyRegistry registry) {
        registry.add("repohive.sse.heartbeat-ms", () -> "300");
    }

    @Autowired StreamRegistry streams;

    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    private HttpResponse<InputStream> open(String jobId, String ip, String lastEventId) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/jobs/" + jobId + "/events"))
                .header("X-Forwarded-For", ip);
        if (lastEventId != null) {
            request.header("Last-Event-ID", lastEventId);
        }
        return CLIENT.send(request.build(), HttpResponse.BodyHandlers.ofInputStream());
    }

    private static String readAll(HttpResponse<InputStream> response) throws IOException {
        try (InputStream in = response.body()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /** Reads until the text contains the marker. */
    private static String readUntil(InputStream in, String marker) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        while (!bytes.toString(StandardCharsets.UTF_8).contains(marker)) {
            int b = in.read();
            if (b < 0) {
                break;
            }
            bytes.write(b);
        }
        return bytes.toString(StandardCharsets.UTF_8);
    }

    private String job() {
        return Seed.job(jdbc, clock.instant(), Seed.account(jdbc), REPO, "S");
    }

    @Test
    void aFinishedJobIsOneDoneFrameThenTheStreamCloses() throws Exception {
        String id = job();
        jdbc.update("UPDATE job_executions SET status = 'SUCCEEDED', state = 'succeeded' WHERE id = ?", id);
        HttpResponse<InputStream> response = open(id, Http.freshIp(), null);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Content-Type").orElseThrow().replace(" ", "")).isEqualTo("text/event-stream;charset=utf-8");
        assertThat(response.headers().firstValue("Cache-Control")).hasValue("no-cache, no-transform");
        assertThat(response.headers().firstValue("Connection")).hasValue("keep-alive");
        assertThat(readAll(response)).isEqualTo("id: 1\nevent: done\ndata: {\"jobId\":\"" + id + "\",\"repo\":\"" + REPO
                + "\",\"state\":\"succeeded\",\"result\":{\"snapshotId\":\"" + SNAPSHOT + "\"}}\n\n");
    }

    @Test
    void aFailedJobCarriesTheFailureCode() throws Exception {
        String id = job();
        jdbc.update("UPDATE job_executions SET status = 'FAILED', state = 'failed', failure_class = 'user', failure_code = 'TOO_LARGE' WHERE id = ?", id);
        assertThat(readAll(open(id, Http.freshIp(), null))).isEqualTo("id: 1\nevent: done\ndata: {\"jobId\":\"" + id + "\",\"repo\":\"" + REPO
                + "\",\"state\":\"failed\",\"failure\":{\"code\":\"TOO_LARGE\"}}\n\n");
    }

    @Test
    void anUnknownJobIsOneNotFoundFrame() throws Exception {
        assertThat(readAll(open("nope", Http.freshIp(), null)))
                .isEqualTo("id: 1\nevent: done\ndata: {\"jobId\":\"nope\",\"state\":\"failed\",\"failure\":{\"code\":\"NOT_FOUND\"}}\n\n");
    }

    @Test
    void lastEventIdSkipsFramesAlreadySeen() throws Exception {
        String id = job();
        jdbc.update("UPDATE job_executions SET status = 'SUCCEEDED', state = 'succeeded' WHERE id = ?", id);
        assertThat(readAll(open(id, Http.freshIp(), "1"))).isEmpty();
        assertThat(readAll(open(id, Http.freshIp(), "junk"))).startsWith("id: 1\nevent: done");
    }

    @Test
    void aRunningJobStreamsProgressFramesThenDone() throws Exception {
        String id = job();
        jdbc.update("UPDATE job_executions SET state = 'parsing', progress_stage = 'parse', progress_completed = 2, progress_total = 10 WHERE id = ?", id);
        HttpResponse<InputStream> response = open(id, Http.freshIp(), null);
        try (InputStream in = response.body()) {
            String first = readUntil(in, "\n\n");
            assertThat(first).isEqualTo("id: 1\nevent: progress\ndata: {\"jobId\":\"" + id + "\",\"repo\":\"" + REPO
                    + "\",\"state\":\"parsing\",\"progress\":{\"stage\":\"parse\",\"completed\":2,\"total\":10}}\n\n");
            jdbc.update("UPDATE job_executions SET status = 'SUCCEEDED', state = 'succeeded' WHERE id = ?", id);
            String rest = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            assertThat(rest).contains("event: done\ndata: {\"jobId\":\"" + id + "\"").endsWith("\"result\":{\"snapshotId\":\"" + SNAPSHOT + "\"}}\n\n");
            List<String> ids = new ArrayList<>();
            for (String line : rest.split("\n")) {
                if (line.startsWith("id: ")) {
                    ids.add(line);
                }
            }
            assertThat(ids).isNotEmpty();
            assertThat(ids.get(0)).isEqualTo("id: 2");
        }
    }

    @Test
    void heartbeatsAreComments() throws Exception {
        String id = job();
        try (InputStream in = open(id, Http.freshIp(), null).body()) {
            String text = readUntil(in, ": heartbeat\n\n");
            assertThat(text).endsWith(": heartbeat\n\n").startsWith("id: 1\nevent: progress");
        }
    }

    @Test
    void theSixthStreamFromOneAddressIs429AndClosingFreesSlots() throws Exception {
        String id = job();
        String ip = Http.freshIp();
        List<HttpResponse<InputStream>> open = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            HttpResponse<InputStream> response = open(id, ip, null);
            assertThat(response.statusCode()).isEqualTo(200);
            open.add(response);
        }
        HttpResponse<InputStream> sixth = open(id, ip, null);
        assertThat(sixth.statusCode()).isEqualTo(429);
        assertThat(readAll(sixth)).isEqualTo("{\"code\":\"TOO_MANY_STREAMS\",\"message\":\"Too many open progress streams.\"}");
        // Another address is not affected.
        HttpResponse<InputStream> other = open(id, Http.freshIp(), null);
        assertThat(other.statusCode()).isEqualTo(200);
        other.body().close();

        for (HttpResponse<InputStream> response : open) {
            response.body().close();
        }
        long deadline = System.currentTimeMillis() + 10_000;
        while (streams.open(ip) > 0 && System.currentTimeMillis() < deadline) {
            Thread.sleep(100);
        }
        assertThat(streams.open(ip)).isZero();
        HttpResponse<InputStream> again = open(id, ip, null);
        assertThat(again.statusCode()).isEqualTo(200);
        again.body().close();
    }
}
