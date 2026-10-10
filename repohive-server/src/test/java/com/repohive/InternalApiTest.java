package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.service.JobService;
import com.repohive.support.Http;
import com.repohive.support.Seed;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class InternalApiTest extends JobTestBase {

    @Autowired JobService jobs;

    /** A dispatched (RUNNING) job of the tier. */
    private String running(String tier) {
        String id = Seed.job(jdbc, clock.instant(), Seed.account(jdbc), REPO, tier);
        jobs.dispatch(id);
        assertThat(jobColumn(id, "status")).isEqualTo("RUNNING");
        return id;
    }

    private Http.Resp progress(String body) throws Exception {
        return internalPost("/api/internal/jobs/progress", body);
    }

    private Http.Resp complete(String body) throws Exception {
        return internalPost("/api/internal/jobs/complete", body);
    }

    @Test
    void aMissingOrWrongSecretIs401OnEveryEndpoint() throws Exception {
        String id = running("S");
        for (Map<String, String> headers : new Map[] {Map.of(), bearer("wrong"), Map.of("Authorization", "Basic " + SECRET), Map.of("Authorization", SECRET)}) {
            for (String[] call : new String[][] {{"POST", "/api/internal/jobs/progress"}, {"POST", "/api/internal/jobs/complete"},
                    {"GET", "/api/internal/repos/acme/widgets/active"}}) {
                Http.Resp response = http.send(call[0], call[1], call[0].equals("POST") ? "{\"jobId\":\"" + id + "\"}" : null, headers);
                assertThat(response.getStatus()).as(call[1] + headers).isEqualTo(401);
                assertThat(response.getContentAsString()).isEqualTo("{\"code\":\"UNAUTHORIZED\",\"message\":\"Unauthorized.\"}");
            }
        }
        assertThat(jobColumn(id, "state")).isEqualTo("queued");
    }

    @Test
    void noOriginAndNoSessionAreNeeded() throws Exception {
        String id = running("S");
        assertThat(http.send("POST", "/api/internal/jobs/progress", "{\"jobId\":\"" + id + "\",\"state\":\"fetching\"}", bearer(SECRET)).getStatus())
                .isEqualTo(204);
    }

    @Test
    void progressOnlyMovesStateForwardAndReplacesProgress() throws Exception {
        String id = running("S");
        Http.Resp ok = progress("{\"jobId\":\"" + id + "\",\"state\":\"parsing\",\"progress\":{\"stage\":\"parse\",\"completed\":10,\"total\":2985}}");
        assertThat(ok.getStatus()).isEqualTo(204);
        assertThat(ok.body()).isEmpty();
        assertThat(jobColumn(id, "state")).isEqualTo("parsing");
        assertThat(jobColumn(id, "progress_completed")).isEqualTo("10");
        assertThat(jobColumn(id, "updated_at")).isEqualTo("2026-10-03T12:00:00.000Z");

        assertThat(progress("{\"jobId\":\"" + id + "\",\"state\":\"fetching\"}").getStatus()).isEqualTo(204);
        assertThat(jobColumn(id, "state")).isEqualTo("parsing");
        assertThat(jobColumn(id, "progress_stage")).isEqualTo("parse");

        assertThat(progress("{\"jobId\":\"" + id + "\",\"progress\":{\"stage\":\"group\"}}").getStatus()).isEqualTo(204);
        assertThat(jobColumn(id, "state")).isEqualTo("parsing");
        assertThat(jobColumn(id, "progress_stage")).isEqualTo("group");
        assertThat(jobColumn(id, "progress_completed")).isNull();

        assertThat(progress("{\"jobId\":\"" + id + "\",\"state\":\"publishing\"}").getStatus()).isEqualTo(204);
        assertThat(jobColumn(id, "state")).isEqualTo("publishing");
        // A terminal state is not a progress report.
        assertThat(progress("{\"jobId\":\"" + id + "\",\"state\":\"succeeded\"}").getStatus()).isEqualTo(204);
        assertThat(jobColumn(id, "state")).isEqualTo("publishing");
        assertThat(jobColumn(id, "status")).isEqualTo("RUNNING");
    }

    @Test
    void progressRejectsUnknownJobsBadBodiesAndEndedJobs() throws Exception {
        assertThat(progress("{\"jobId\":\"nope\",\"state\":\"parsing\"}").getStatus()).isEqualTo(404);
        assertThat(progress("garbage").getStatus()).isEqualTo(400);
        assertThat(progress("{\"jobId\":\"x\",\"state\":\"flying\"}").getStatus()).isEqualTo(400);
        String id = running("S");
        assertThat(complete("{\"jobId\":\"" + id + "\",\"status\":\"failed\",\"failureClass\":\"user\",\"failureCode\":\"X\",\"message\":\"m\"}").getStatus()).isEqualTo(204);
        Http.Resp closed = progress("{\"jobId\":\"" + id + "\",\"state\":\"parsing\"}");
        assertThat(closed.getStatus()).isEqualTo(409);
        assertThat(closed.getContentAsString()).isEqualTo("{\"code\":\"JOB_NOT_OPEN\",\"message\":\"The job has already ended.\"}");
    }

    @Test
    void succeededSetsThePointerAndCounts() throws Exception {
        String id = running("S");
        clock.advance(java.time.Duration.ofMinutes(2));
        String body = "{\"jobId\":\"" + id + "\",\"status\":\"succeeded\",\"snapshotId\":\"" + SNAPSHOT
                + "\",\"commitSha\":\"deadbeef\",\"engineVersion\":\"e9\",\"viewsVersion\":\"v9\",\"nodeCount\":1234,\"edgeCount\":5678}";
        assertThat(complete(body.replace(SNAPSHOT, "0".repeat(32))).getStatus()).isEqualTo(400);
        assertThat(jobColumn(id, "status")).isEqualTo("RUNNING");

        assertThat(complete(body).getStatus()).isEqualTo(204);
        assertThat(jobColumn(id, "status")).isEqualTo("SUCCEEDED");
        assertThat(jobColumn(id, "state")).isEqualTo("succeeded");
        assertThat(jobColumn(id, "ended_at")).isEqualTo("2026-10-03T12:02:00.000Z");
        assertThat(refunded(id)).isZero();
        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM indexed_repositories WHERE repo = ?", REPO);
        assertThat(row).containsEntry("snapshot_id", SNAPSHOT).containsEntry("commit_sha", "deadbeef").containsEntry("engine_version", "e9")
                .containsEntry("views_version", "v9").containsEntry("node_count", 1234).containsEntry("edge_count", 5678)
                .containsEntry("indexed_at", "2026-10-03T12:02:00.000Z").containsEntry("job_id", id);

        assertThat(http.get("/api/repos/acme/widgets", null, null).getContentAsString()).contains("\"nodeCount\":1234").contains("\"edgeCount\":5678");
        assertThat(http.send("GET", "/api/internal/repos/acme/widgets/active", null, bearer(SECRET)).getContentAsString())
                .isEqualTo("{\"snapshotId\":\"" + SNAPSHOT + "\"}");
        // The worker retries: an ended job answers 409.
        assertThat(complete(body).getStatus()).isEqualTo(409);
    }

    @Test
    void activeIsNullWhenNothingIsIndexed() throws Exception {
        Http.Resp response = http.send("GET", "/api/internal/repos/acme/widgets/active", null, bearer(SECRET));
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsString()).isEqualTo("{\"snapshotId\":null}");
    }

    @Test
    void aUserFailureIsNotRefunded() throws Exception {
        String id = running("S");
        assertThat(complete("{\"jobId\":\"" + id + "\",\"status\":\"failed\",\"failureClass\":\"user\",\"failureCode\":\"TOO_LARGE\",\"message\":\"big\"}").getStatus())
                .isEqualTo(204);
        assertThat(jobColumn(id, "status")).isEqualTo("FAILED");
        assertThat(jobColumn(id, "state")).isEqualTo("failed");
        assertThat(jobColumn(id, "failure_class")).isEqualTo("user");
        assertThat(jobColumn(id, "failure_code")).isEqualTo("TOO_LARGE");
        assertThat(refunded(id)).isZero();
    }

    @Test
    void aSystemFailureIsRefunded() throws Exception {
        String id = running("S");
        assertThat(complete("{\"jobId\":\"" + id + "\",\"status\":\"failed\",\"failureClass\":\"system\",\"failureCode\":\"TIME_LIMIT\",\"message\":\"slow\"}").getStatus())
                .isEqualTo(204);
        assertThat(jobColumn(id, "failure_code")).isEqualTo("TIME_LIMIT");
        assertThat(refunded(id)).isEqualTo(1);
        assertThat(complete("{\"jobId\":\"" + id + "\",\"status\":\"failed\",\"failureClass\":\"system\",\"failureCode\":\"X\",\"message\":\"\"}").getStatus()).isEqualTo(409);
    }

    @Test
    void badCompletionsAre400AndUnknownJobsAre404() throws Exception {
        String id = running("S");
        for (String body : new String[] {"{\"jobId\":\"" + id + "\"}", "{\"jobId\":\"" + id + "\",\"status\":\"weird\"}",
                "{\"jobId\":\"" + id + "\",\"status\":\"failed\",\"failureClass\":\"maybe\",\"failureCode\":\"X\"}",
                "{\"jobId\":\"" + id + "\",\"status\":\"succeeded\",\"snapshotId\":\"" + SNAPSHOT + "\"}",
                "{\"jobId\":\"" + id + "\",\"status\":\"retier\",\"tier\":\"XXL\"}",
                "{\"jobId\":\"" + id + "\",\"status\":\"retier\",\"tier\":\"S\"}"}) {
            assertThat(complete(body).getStatus()).as(body).isEqualTo(400);
        }
        assertThat(complete("{\"jobId\":\"nope\",\"status\":\"retier\",\"tier\":\"M\"}").getStatus()).isEqualTo(404);
        assertThat(jobColumn(id, "status")).isEqualTo("RUNNING");
    }

    @Test
    void retierRequeuesAndRedispatchesAndAThirdRetierFails() throws Exception {
        String id = running("S");
        clock.advance(java.time.Duration.ofMinutes(1));
        assertThat(complete("{\"jobId\":\"" + id + "\",\"status\":\"retier\",\"tier\":\"M\"}").getStatus()).isEqualTo(204);
        assertThat(jobColumn(id, "tier")).isEqualTo("M");
        assertThat(jobColumn(id, "retier_count")).isEqualTo("1");
        assertThat(jobColumn(id, "queued_at")).isEqualTo("2026-10-03T12:01:00.000Z");
        assertThat(jobColumn(id, "status")).isEqualTo("RUNNING");
        assertThat(dispatch.started.get(1).name()).isEqualTo(id + "-r1");
        assertThat(dispatch.started.get(1).input().tier()).isEqualTo("M");

        assertThat(complete("{\"jobId\":\"" + id + "\",\"status\":\"retier\",\"tier\":\"L\"}").getStatus()).isEqualTo(204);
        assertThat(jobColumn(id, "retier_count")).isEqualTo("2");
        assertThat(dispatch.started.get(2).name()).isEqualTo(id + "-r2");
        assertThat(jobColumn(id, "status")).isEqualTo("RUNNING");

        assertThat(complete("{\"jobId\":\"" + id + "\",\"status\":\"retier\",\"tier\":\"XL\"}").getStatus()).isEqualTo(204);
        assertThat(jobColumn(id, "status")).isEqualTo("FAILED");
        assertThat(jobColumn(id, "failure_class")).isEqualTo("system");
        assertThat(jobColumn(id, "failure_code")).isEqualTo("retier-limit");
        assertThat(refunded(id)).isEqualTo(1);
        assertThat(dispatch.started).hasSize(3);
    }

    @Test
    void aRetierToALargeTierWaitsWhenTheSlotIsTaken() throws Exception {
        String large = running("L");
        String id = running2("S", "github.com/acme/second");
        assertThat(complete("{\"jobId\":\"" + id + "\",\"status\":\"retier\",\"tier\":\"L\"}").getStatus()).isEqualTo(204);
        assertThat(jobColumn(id, "status")).isEqualTo("QUEUED");
        assertThat(jobColumn(id, "state")).isEqualTo("waiting-for-slot");
        assertThat(jobColumn(large, "status")).isEqualTo("RUNNING");
    }

    private String running2(String tier, String repo) {
        String id = Seed.job(jdbc, clock.instant(), Seed.account(jdbc), repo, tier);
        jobs.dispatch(id);
        return id;
    }
}
