package com.repohive;

import static com.repohive.support.Http.cookiePair;
import static com.repohive.support.Http.credentials;
import static com.repohive.support.Http.freshEmail;
import static com.repohive.support.Http.freshIp;

import com.repohive.support.FakeDispatchService;
import com.repohive.support.FakePrecheckRunner;
import com.repohive.support.Http;
import com.repohive.support.Seed;
import com.repohive.support.TestClock;
import com.repohive.support.TestClockConfig;
import com.repohive.support.TestEnv;
import com.repohive.support.TestJobBeans;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** A local-mode server with a fake dispatcher and a fake pre-check, a clean job table and a settable clock. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import({TestClockConfig.class, TestJobBeans.class})
abstract class JobTestBase {

    static final Path DIR = TestEnv.tempDir();
    static final String SECRET = "test-internal-secret";
    static final String REPO = "github.com/acme/widgets";
    static final String SNAPSHOT = "5".repeat(32);

    @DynamicPropertySource
    static void baseProps(DynamicPropertyRegistry registry) {
        TestEnv.local(registry, DIR);
    }

    @LocalServerPort int port;
    @Autowired TestClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired FakeDispatchService dispatch;
    @Autowired FakePrecheckRunner precheck;

    Http http;

    @BeforeEach
    void resetBase() {
        clock.reset();
        Seed.clear(jdbc);
        dispatch.reset();
        precheck.reset();
        http = new Http(port, TestEnv.LOCAL_ORIGIN, "X-Forwarded-For");
    }

    String signUp() throws Exception {
        return cookiePair(http.post("/api/auth/sign-up", credentials(freshEmail(), "1234567890"), freshIp(), null));
    }

    Map<String, String> bearer(String secret) {
        return Map.of("Authorization", "Bearer " + secret, "Content-Type", "application/json");
    }

    Http.Resp internalPost(String path, String body) throws Exception {
        return http.send("POST", path, body, bearer(SECRET));
    }

    String jobColumn(String jobId, String column) {
        return jdbc.queryForObject("SELECT " + column + " FROM job_executions WHERE id = ?", String.class, jobId);
    }

    int refunded(String jobId) {
        return jdbc.queryForObject("SELECT refunded FROM index_charges WHERE job_id = ?", Integer.class, jobId);
    }
}
