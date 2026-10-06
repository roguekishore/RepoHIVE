package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.support.Http;
import com.repohive.support.TestEnv;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** No admin token configured: the admin API does not exist as far as a caller can tell. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AdminLimitsOffTest {

    static final Path DIR = TestEnv.tempDir();

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        TestEnv.local(registry, DIR);
    }

    @LocalServerPort int port;

    @Test
    void everyMethodAnswersNotFoundWhateverTheCaller() throws Exception {
        Http http = new Http(port, TestEnv.LOCAL_ORIGIN, "X-Forwarded-For");
        Map<String, String> withToken = Map.of("Authorization", "Bearer " + TestEnv.ADMIN_TOKEN, "Content-Type", "application/json");
        assertThat(http.send("GET", "/api/admin/limits", null, withToken).getStatus()).isEqualTo(404);
        assertThat(http.send("PUT", "/api/admin/limits", "{\"limits\":{\"inFlightCap\":9}}", withToken).getStatus()).isEqualTo(404);
        assertThat(http.send("GET", "/api/admin/limits", null, Map.of()).getStatus()).isEqualTo(404);
        Http.Resp preflight = http.send("OPTIONS", "/api/admin/limits", null,
                Map.of("Origin", TestEnv.ADMIN_ORIGIN, "Access-Control-Request-Method", "PUT"));
        assertThat(preflight.getHeader("Access-Control-Allow-Origin")).isNull();
    }
}
