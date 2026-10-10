package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.support.Http;
import com.repohive.support.Seed;
import org.junit.jupiter.api.Test;

class JobStatusTest extends JobTestBase {

    private String job() {
        return Seed.job(jdbc, clock.instant(), Seed.account(jdbc), REPO, "S");
    }

    private String status(String id) throws Exception {
        Http.Resp response = http.get("/api/jobs/" + id, null, null);
        assertThat(response.getStatus()).isEqualTo(200);
        return response.getContentAsString();
    }

    @Test
    void unknownJobIs404() throws Exception {
        Http.Resp response = http.get("/api/jobs/nope", null, null);
        assertThat(response.getStatus()).isEqualTo(404);
        assertThat(response.getContentAsString()).isEqualTo("{\"code\":\"NOT_FOUND\",\"message\":\"Unknown job.\"}");
    }

    @Test
    void progressOmitsNulls() throws Exception {
        String id = job();
        jdbc.update("UPDATE job_executions SET state = 'parsing', progress_stage = 'parse', progress_completed = 10, progress_total = 2985 WHERE id = ?", id);
        assertThat(status(id)).isEqualTo("{\"repo\":\"" + REPO + "\",\"state\":\"parsing\",\"progress\":{\"stage\":\"parse\",\"completed\":10,\"total\":2985}}");
        jdbc.update("UPDATE job_executions SET progress_completed = NULL, progress_total = NULL WHERE id = ?", id);
        assertThat(status(id)).isEqualTo("{\"repo\":\"" + REPO + "\",\"state\":\"parsing\",\"progress\":{\"stage\":\"parse\"}}");
    }

    @Test
    void succeededCarriesTheSnapshot() throws Exception {
        String id = job();
        jdbc.update("UPDATE job_executions SET status = 'SUCCEEDED', state = 'succeeded' WHERE id = ?", id);
        assertThat(status(id)).isEqualTo("{\"repo\":\"" + REPO + "\",\"state\":\"succeeded\",\"result\":{\"snapshotId\":\"" + SNAPSHOT + "\"}}");
    }

    @Test
    void failedCarriesTheCodeOrAGenericOne() throws Exception {
        String id = job();
        jdbc.update("UPDATE job_executions SET status = 'FAILED', state = 'failed', failure_class = 'user', failure_code = 'TOO_LARGE' WHERE id = ?", id);
        assertThat(status(id)).isEqualTo("{\"repo\":\"" + REPO + "\",\"state\":\"failed\",\"failure\":{\"code\":\"TOO_LARGE\",\"message\":\"TOO_LARGE\"}}");
        jdbc.update("UPDATE job_executions SET failure_code = NULL WHERE id = ?", id);
        assertThat(status(id)).isEqualTo("{\"repo\":\"" + REPO + "\",\"state\":\"failed\",\"failure\":{\"code\":\"FAILED\",\"message\":\"The index failed.\"}}");
    }
}
