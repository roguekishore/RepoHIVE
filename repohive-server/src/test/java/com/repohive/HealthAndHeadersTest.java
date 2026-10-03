package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.support.Http;
import com.repohive.support.TestClockConfig;
import com.repohive.support.TestEnv;
import java.nio.file.Path;
import java.sql.Connection;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestClockConfig.class)
class HealthAndHeadersTest {

    static final Path DIR = TestEnv.tempDir();

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        TestEnv.local(registry, DIR);
    }

    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired DataSource dataSource;

    private final ObjectMapper json = new ObjectMapper();

    private Http http() {
        return new Http(port, TestEnv.LOCAL_ORIGIN, "X-Forwarded-For");
    }

    private void indexed(String repo, String indexedAt) {
        jdbc.update("INSERT INTO accounts (id, email, password_salt, password_hash, scrypt_n, scrypt_r, scrypt_p, created_at,"
                + " created_utc_day, created_ip) SELECT 'h', 'h@example.com', 'a', 'b', 1, 1, 1, 't', 'd', 'i'"
                + " WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE id = 'h')");
        jdbc.update("INSERT INTO indexed_repositories (repo, snapshot_id, commit_sha, node_count, edge_count, indexed_at, job_id)"
                + " VALUES (?, 's', 'c', 1, 1, ?, 'j')", repo, indexedAt);
    }

    @Test
    void healthIsOkWithVersionAndNullLastCompletedJobWhenNothingIsIndexed() throws Exception {
        jdbc.update("DELETE FROM indexed_repositories");
        Http.Resp response = http().get("/healthz", null, null);
        assertThat(response.getStatus()).isEqualTo(200);
        JsonNode body = json.readTree(response.getContentAsString());
        assertThat(body.fieldNames()).toIterable().containsExactly("status", "version", "ledgerReachable", "lastCompletedJobAt");
        assertThat(body.get("status").asText()).isEqualTo("ok");
        assertThat(body.get("version").asText()).isEqualTo("0.1.0");
        assertThat(body.get("ledgerReachable").asBoolean()).isTrue();
        assertThat(body.get("lastCompletedJobAt").isNull()).isTrue();
    }

    @Test
    void lastCompletedJobAtIsTheNewestIndexedAt() throws Exception {
        jdbc.update("DELETE FROM indexed_repositories");
        indexed("github.com/a/one", "2026-10-01T00:00:00.000Z");
        indexed("github.com/a/two", "2026-10-02T08:30:00.000Z");
        JsonNode body = json.readTree(http().get("/healthz", null, null).getContentAsString());
        assertThat(body.get("lastCompletedJobAt").asText()).isEqualTo("2026-10-02T08:30:00.000Z");
        assertThat(body.get("status").asText()).isEqualTo("ok");
    }

    @Test
    void healthIsDegradedWith503WhenTheDatabaseDoesNotAnswerInTime() throws Exception {
        // Hold the only connection: the probe cannot run, so it is not answered within 800 ms.
        try (Connection held = dataSource.getConnection()) {
            long start = System.nanoTime();
            Http.Resp response = http().get("/healthz", null, null);
            long elapsedMs = (System.nanoTime() - start) / 1_000_000;
            assertThat(response.getStatus()).isEqualTo(503);
            JsonNode body = json.readTree(response.getContentAsString());
            assertThat(body.get("status").asText()).isEqualTo("degraded");
            assertThat(body.get("ledgerReachable").asBoolean()).isFalse();
            assertThat(body.get("lastCompletedJobAt").isNull()).isTrue();
            assertThat(elapsedMs).isLessThan(5_000);
            assertThat(held.isClosed()).isFalse();
        }
        assertThat(json.readTree(http().get("/healthz", null, null).getContentAsString()).get("status").asText()).isEqualTo("ok");
    }

    @Test
    void securityHeadersAreOnEveryResponse() throws Exception {
        Http http = http();
        Http.Resp[] responses = {
            http.get("/healthz", null, null),
            http.get("/api/auth/session", null, null),
            http.get("/api/quota", null, null),
            http.post("/api/auth/sign-up", "{}", null, null, null, false),
            http.post("/api/auth/sign-in", "{}", null, null),
            http.get("/artifacts/nothing/here.json", null, null),
            http.get("/no/such/path", null, null),
        };
        for (Http.Resp response : responses) {
            assertThat(response.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
            assertThat(response.getHeader("Referrer-Policy")).isEqualTo("strict-origin-when-cross-origin");
            assertThat(response.getHeader("Content-Security-Policy")).isEqualTo("frame-ancestors 'none'");
        }
    }
}
