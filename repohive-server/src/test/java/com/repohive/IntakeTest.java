package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.model.PrecheckResult;
import com.repohive.support.Http;
import com.repohive.support.Seed;
import com.repohive.service.RuntimeLimits;
import com.repohive.service.TimeFormat;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

@ExtendWith(OutputCaptureExtension.class)
class IntakeTest extends JobTestBase {

    static final String BODY = "{\"repo\":\"acme/widgets\"}";

    String cookie;
    String ip;

    @BeforeEach
    void signedIn() throws Exception {
        cookie = signUp();
        ip = Http.freshIp();
        precheck.answer = text -> new PrecheckResult.Accepted(REPO, "c0ffee", "S", SNAPSHOT, 10, 1000, false);
    }

    Http.Resp post(String body) throws Exception {
        return http.post("/api/index", body, ip, cookie);
    }

    int charges() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM index_charges", Integer.class);
    }

    @Test
    void originIsCheckedFirst() throws Exception {
        Http.Resp response = http.post("/api/index", BODY, ip, cookie, "http://evil.example", true);
        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).isEqualTo("{\"code\":\"ORIGIN_REJECTED\",\"message\":\"Origin not allowed.\"}");
        assertThat(http.post("/api/index", "nonsense", ip, null, null, false).getStatus()).isEqualTo(403);
    }

    @Test
    void aBadBodyIs400BeforeTheSessionIsLookedAt() throws Exception {
        for (String body : new String[] {"", "nonsense", "[]", "{}", "{\"repo\":5}", "{\"repo\":\"   \"}"}) {
            Http.Resp response = http.post("/api/index", body, ip, null);
            assertThat(response.getStatus()).as(body).isEqualTo(400);
            assertThat(response.getContentAsString()).isEqualTo("{\"code\":\"BAD_REQUEST\",\"message\":\"Expected a repository reference.\"}");
        }
    }

    @Test
    void noSessionIs401() throws Exception {
        Http.Resp response = http.post("/api/index", BODY, ip, null);
        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).isEqualTo("{\"code\":\"UNAUTHENTICATED\",\"message\":\"Sign in to request an index.\"}");
        assertThat(precheck.calls).isZero();
    }

    @Test
    void acceptedDispatchesOnceAndExposesTheJob(CapturedOutput output) throws Exception {
        Http.Resp response = post(BODY);
        assertThat(response.getStatus()).isEqualTo(202);
        assertThat(response.getContentAsString()).matches("\\{\"status\":\"accepted\",\"jobId\":\"[0-9a-f]{32}\"}");
        String jobId = response.getContentAsString().replaceAll(".*\"jobId\":\"([0-9a-f]+)\".*", "$1");

        assertThat(dispatch.started).hasSize(1);
        assertThat(dispatch.started.get(0).name()).isEqualTo(jobId);
        assertThat(dispatch.started.get(0).input().repo()).isEqualTo(REPO);
        assertThat(dispatch.started.get(0).input().tier()).isEqualTo("S");
        assertThat(jobColumn(jobId, "status")).isEqualTo("RUNNING");
        assertThat(jobColumn(jobId, "state")).isEqualTo("queued");
        assertThat(jobColumn(jobId, "execution_ref")).isEqualTo("ref:" + jobId);
        assertThat(jobColumn(jobId, "created_at")).isEqualTo("2026-10-03T12:00:00.000Z");
        assertThat(jobColumn(jobId, "started_at")).isEqualTo("2026-10-03T12:00:00.000Z");
        assertThat(charges()).isEqualTo(1);

        Http.Resp status = http.get("/api/jobs/" + jobId, null, null);
        assertThat(status.getContentAsString()).isEqualTo("{\"repo\":\"" + REPO + "\",\"state\":\"queued\"}");

        // InFlight is emitted before the outcome metric.
        String out = output.getOut();
        assertThat(out.indexOf("\"InFlight\":1")).isGreaterThanOrEqualTo(0).isLessThan(out.indexOf("\"JobsAccepted\":1"));
    }

    @Test
    void cachedIsNotChargedAndStartsNothing() throws Exception {
        jdbc.update("INSERT INTO indexed_repositories (repo, snapshot_id, commit_sha, node_count, edge_count, indexed_at, job_id)"
                + " VALUES (?, ?, 'c0ffee', 1, 1, '2026-10-01T00:00:00.000Z', 'j')", REPO, SNAPSHOT);
        Http.Resp response = post(BODY);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsString()).isEqualTo("{\"status\":\"cached\",\"repo\":\"" + REPO + "\",\"snapshotId\":\"" + SNAPSHOT + "\"}");
        assertThat(charges()).isZero();
        assertThat(dispatch.started).isEmpty();
    }

    @Test
    void aDifferentIndexedSnapshotIsNotACacheHit() throws Exception {
        jdbc.update("INSERT INTO indexed_repositories (repo, snapshot_id, commit_sha, node_count, edge_count, indexed_at, job_id)"
                + " VALUES (?, ?, 'c0ffee', 1, 1, '2026-10-01T00:00:00.000Z', 'j')", REPO, "9".repeat(32));
        assertThat(post(BODY).getStatus()).isEqualTo(202);
    }

    @Test
    void joinedReturnsTheOpenJobAndIsNotCharged() throws Exception {
        String other = Seed.account(jdbc);
        String existing = Seed.job(jdbc, clock.instant(), other, REPO, "S");
        int before = charges();
        Http.Resp response = post(BODY);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsString()).isEqualTo("{\"status\":\"joined\",\"jobId\":\"" + existing + "\"}");
        assertThat(charges()).isEqualTo(before);
        assertThat(dispatch.started).isEmpty();
    }

    @Test
    void busyReleasesTheChargeAndStartsNothing() throws Exception {
        for (int i = 0; i < 5; i++) {
            Seed.job(jdbc, clock.instant(), Seed.account(jdbc), "github.com/x/r" + i, "S");
        }
        int before = charges();
        Http.Resp response = post(BODY);
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(response.getHeader("Retry-After")).isEqualTo("120");
        assertThat(response.getContentAsString()).isEqualTo("{\"status\":\"busy\",\"retryAfterSeconds\":120}");
        assertThat(charges()).isEqualTo(before);
        assertThat(dispatch.started).isEmpty();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM job_executions", Integer.class)).isEqualTo(5);
    }

    @Test
    void theInFlightCapIsTheSavedValueNotACompiledOne() throws Exception {
        for (int i = 0; i < 2; i++) {
            Seed.job(jdbc, clock.instant(), Seed.account(jdbc), "github.com/x/r" + i, "S");
        }
        runtimeLimits.update(Map.of(RuntimeLimits.Limit.IN_FLIGHT_CAP, 2), "test");
        Http.Resp busy = post(BODY);
        assertThat(busy.getStatus()).isEqualTo(503);
        assertThat(busy.getContentAsString()).isEqualTo("{\"status\":\"busy\",\"retryAfterSeconds\":120}");
        assertThat(dispatch.started).isEmpty();

        // Raised above the old fixed five, with two open: accepted.
        runtimeLimits.update(Map.of(RuntimeLimits.Limit.IN_FLIGHT_CAP, 3), "test");
        assertThat(post(BODY).getStatus()).isEqualTo(202);
        assertThat(dispatch.started).hasSize(1);
    }

    @Test
    void aStartFailureRefundsAndAnswers503() throws Exception {
        dispatch.failStart = true;
        Http.Resp response = post(BODY);
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(response.getContentAsString()).isEqualTo(
                "{\"status\":\"rejected\",\"code\":\"ORCHESTRATOR_START_FAILED\",\"message\":\"The index could not be started. Your request was not charged.\"}");
        String jobId = jdbc.queryForObject("SELECT id FROM job_executions", String.class);
        assertThat(jobColumn(jobId, "status")).isEqualTo("FAILED");
        assertThat(jobColumn(jobId, "state")).isEqualTo("failed");
        assertThat(jobColumn(jobId, "failure_class")).isEqualTo("system");
        assertThat(jobColumn(jobId, "failure_code")).isEqualTo("ORCHESTRATOR_START_FAILED");
        assertThat(refunded(jobId)).isEqualTo(1);
    }

    @Test
    void precheckRejectionsAre422WithTheUpperSnakeCode() throws Exception {
        precheck.answer = text -> new PrecheckResult.Rejected("not-found", "No such repository.");
        Http.Resp response = post(BODY);
        assertThat(response.getStatus()).isEqualTo(422);
        assertThat(response.getContentAsString()).isEqualTo("{\"status\":\"rejected\",\"code\":\"NOT_FOUND\",\"message\":\"No such repository.\"}");
        precheck.answer = text -> new PrecheckResult.Rejected("too-large", "Too big.");
        assertThat(post(BODY).getContentAsString()).contains("\"code\":\"TOO_LARGE\"");
        assertThat(charges()).isZero();
    }

    @Test
    void aPrecheckCrashIs500() throws Exception {
        precheck.crash = true;
        Http.Resp response = post(BODY);
        assertThat(response.getStatus()).isEqualTo(500);
        assertThat(response.getContentAsString()).isEqualTo("{\"code\":\"INTERNAL_ERROR\",\"message\":\"The request could not be processed.\"}");
    }

    @Test
    void theHourlyPrecheckLimitIs429() throws Exception {
        precheck.answer = text -> new PrecheckResult.Rejected("not-found", "No such repository.");
        for (int i = 0; i < 20; i++) {
            assertThat(http.post("/api/index", BODY, Http.freshIp(), cookie).getStatus()).isEqualTo(422);
        }
        Http.Resp response = http.post("/api/index", BODY, Http.freshIp(), cookie);
        assertThat(response.getStatus()).isEqualTo(429);
        assertThat(response.getContentAsString()).isEqualTo(
                "{\"status\":\"rejected\",\"code\":\"PRECHECK_ACCOUNT_LIMIT\",\"message\":\"Too many index checks for your account this hour. Try again later.\"}");
        assertThat(precheck.calls).isEqualTo(20);
    }

    @Test
    void theHourlyIpPrecheckLimitIs429() throws Exception {
        precheck.answer = text -> new PrecheckResult.Rejected("not-found", "No such repository.");
        String sharedIp = Http.freshIp();
        for (int i = 0; i < 40; i++) {
            assertThat(http.post("/api/index", BODY, sharedIp, signUpCookieCached(i)).getStatus()).isEqualTo(422);
        }
        Http.Resp response = http.post("/api/index", BODY, sharedIp, signUpCookieCached(40));
        assertThat(response.getStatus()).isEqualTo(429);
        assertThat(response.getContentAsString()).contains("\"code\":\"PRECHECK_IP_LIMIT\"");
    }

    private final java.util.Map<Integer, String> cookies = new java.util.HashMap<>();

    private String signUpCookieCached(int i) throws Exception {
        // Each account makes at most 20 checks, so a new account every 10 requests.
        int slot = i / 10;
        if (!cookies.containsKey(slot)) {
            cookies.put(slot, signUp());
        }
        return cookies.get(slot);
    }

    @Test
    void anAccountWithAnIndexRunningIsRefused() throws Exception {
        assertThat(post(BODY).getStatus()).isEqualTo(202);
        precheck.answer = text -> new PrecheckResult.Accepted("github.com/acme/other", "c0ffee", "S", "6".repeat(32), 1, 1, false);
        Http.Resp response = post("{\"repo\":\"acme/other\"}");
        assertThat(response.getStatus()).isEqualTo(429);
        assertThat(response.getContentAsString()).isEqualTo(
                "{\"status\":\"rejected\",\"code\":\"INFLIGHT\",\"message\":\"You already have an index running. Wait for it to finish.\"}");
    }

    @Test
    void theDailyAccountQuotaIs429() throws Exception {
        String accountId = jdbc.queryForObject("SELECT account_id FROM sessions WHERE token_hash = ?", String.class,
                com.repohive.service.SessionTokens.hash(cookie.substring(cookie.indexOf('=') + 1)));
        for (int i = 0; i < 5; i++) {
            jdbc.update("INSERT INTO index_charges (job_id, account_id, ip, utc_day, charged_at, refunded) VALUES (?, ?, '9.9.9.9', ?, ?, 0)",
                    "old" + i, accountId, TimeFormat.utcDay(clock.instant()), TimeFormat.iso(clock.instant()));
        }
        Http.Resp response = post(BODY);
        assertThat(response.getStatus()).isEqualTo(429);
        assertThat(response.getContentAsString()).isEqualTo(
                "{\"status\":\"rejected\",\"code\":\"QUOTA_ACCOUNT\",\"message\":\"You have used today's index requests for your account.\"}");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM job_executions", Integer.class)).isZero();
    }

    @Test
    void theDailyIpQuotaIs429() throws Exception {
        String other = Seed.account(jdbc);
        for (int i = 0; i < 10; i++) {
            jdbc.update("INSERT INTO index_charges (job_id, account_id, ip, utc_day, charged_at, refunded) VALUES (?, ?, ?, ?, ?, 0)",
                    "ipold" + i, other, ip, TimeFormat.utcDay(clock.instant()), TimeFormat.iso(clock.instant()));
        }
        Http.Resp response = post(BODY);
        assertThat(response.getStatus()).isEqualTo(429);
        assertThat(response.getContentAsString()).contains("\"code\":\"QUOTA_IP\"").contains("Too many index requests from your network today.");
    }

    @Test
    void aLargeJobWaitsForTheSlotButIsStillAccepted() throws Exception {
        Seed.job(jdbc, clock.instant(), Seed.account(jdbc), "github.com/x/running", "L");
        String running = jdbc.queryForObject("SELECT id FROM job_executions", String.class);
        jdbc.update("UPDATE job_executions SET status = 'RUNNING', execution_ref = 'r', started_at = created_at WHERE id = ?", running);
        precheck.answer = text -> new PrecheckResult.Accepted(REPO, "c0ffee", "XL", SNAPSHOT, 1, 1, false);
        Http.Resp response = post(BODY);
        assertThat(response.getStatus()).isEqualTo(202);
        String jobId = response.getContentAsString().replaceAll(".*\"jobId\":\"([0-9a-f]+)\".*", "$1");
        assertThat(jobColumn(jobId, "status")).isEqualTo("QUEUED");
        assertThat(jobColumn(jobId, "state")).isEqualTo("waiting-for-slot");
        assertThat(dispatch.started).isEmpty();
    }
}
