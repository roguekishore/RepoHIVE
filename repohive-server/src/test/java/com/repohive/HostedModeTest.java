package com.repohive;

import static com.repohive.support.Http.cookiePair;
import static com.repohive.support.Http.credentials;
import static com.repohive.support.Http.freshEmail;
import static com.repohive.support.Http.freshIp;
import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.store.ObjectStore;
import com.repohive.store.S3ObjectStore;
import com.repohive.support.Http;
import com.repohive.support.TestClock;
import com.repohive.support.TestClockConfig;
import com.repohive.support.TestEnv;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
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
class HostedModeTest {

    static final Path DIR = TestEnv.tempDir();
    static final String PASSWORD = "1234567890";

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        TestEnv.hosted(registry, DIR);
    }

    @LocalServerPort int port;
    @Autowired TestClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectStore store;

    Http http;

    @BeforeEach
    void setUp() {
        clock.reset();
        http = new Http(port, TestEnv.HOSTED_ORIGIN, "X-RepoHIVE-Client-IP");
    }

    @Test
    void hostedUsesTheS3Store() {
        assertThat(store).isInstanceOf(S3ObjectStore.class);
    }

    @Test
    void signUpSetsTheHostPrefixedSecureCookie() throws Exception {
        Http.Resp response = http.post("/api/auth/sign-up", credentials(freshEmail(), PASSWORD), freshIp(), null);
        assertThat(response.getStatus()).isEqualTo(201);
        assertThat(response.getHeader("Set-Cookie"))
                .matches("__Host-repohive_session=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; SameSite=Lax; Expires=Mon, 02 Nov 2026 12:00:00 GMT; Secure");
    }

    @Test
    void signOutClearsWithSecure() throws Exception {
        String cookie = cookiePair(http.post("/api/auth/sign-up", credentials(freshEmail(), PASSWORD), freshIp(), null));
        assertThat(http.get("/api/auth/session", null, cookie).getContentAsString()).contains("\"signedIn\":true");
        Http.Resp out = http.post("/api/auth/sign-out", "", null, cookie);
        assertThat(out.getHeader("Set-Cookie")).isEqualTo("__Host-repohive_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure");
        assertThat(http.get("/api/auth/session", null, cookie).getContentAsString()).isEqualTo("{\"signedIn\":false}");
    }

    @Test
    void theLocalCookieNameIsIgnoredInHostedMode() throws Exception {
        String cookie = cookiePair(http.post("/api/auth/sign-up", credentials(freshEmail(), PASSWORD), freshIp(), null));
        String renamed = cookie.replace("__Host-repohive_session", "repohive_session");
        assertThat(http.get("/api/auth/session", null, renamed).getContentAsString()).isEqualTo("{\"signedIn\":false}");
    }

    @Test
    void clientIpComesFromTheConfiguredHeaderOnly() throws Exception {
        String email = freshEmail();
        String ip = freshIp();
        http.post("/api/auth/sign-up", credentials(email, PASSWORD), ip, null);
        assertThat(jdbc.queryForObject("SELECT created_ip FROM accounts WHERE email = ?", String.class, email)).isEqualTo(ip);

        // X-Forwarded-For is ignored in hosted mode; with no configured header the address is 0.0.0.0.
        String other = freshEmail();
        http.send("POST", "/api/auth/sign-up", credentials(other, PASSWORD),
                Map.of("Origin", TestEnv.HOSTED_ORIGIN, "X-Forwarded-For", "203.0.113.77"));
        assertThat(jdbc.queryForObject("SELECT created_ip FROM accounts WHERE email = ?", String.class, other)).isEqualTo("0.0.0.0");

        // The header value is trimmed.
        String third = freshEmail();
        String padded = freshIp();
        http.send("POST", "/api/auth/sign-up", credentials(third, PASSWORD),
                Map.of("Origin", TestEnv.HOSTED_ORIGIN, "X-RepoHIVE-Client-IP", "  " + padded + "  "));
        assertThat(jdbc.queryForObject("SELECT created_ip FROM accounts WHERE email = ?", String.class, third)).isEqualTo(padded);
    }

    @Test
    void originMustBeTheHttpsSiteOrigin() throws Exception {
        assertThat(http.post("/api/auth/sign-up", credentials(freshEmail(), PASSWORD), freshIp(), null, "http://localhost:3000", true).getStatus())
                .isEqualTo(403);
        assertThat(http.post("/api/auth/sign-in", "{}", freshIp(), null, null, false).getStatus()).isEqualTo(403);
    }

    @Test
    void artifactsAreNotServedByTheAppInHostedMode() throws Exception {
        // Even when a matching file exists on disk, hosted mode answers 404 (the CDN serves artifacts).
        Path object = DIR.resolve("store/artifacts/o/r/id/manifest.json");
        Files.createDirectories(object.getParent());
        Files.writeString(object, "{}");
        Files.writeString(Path.of(object + ".headers.json"), "{\"contentType\":\"application/json\"}");
        Http.Resp response = http.get("/artifacts/o/r/id/manifest.json", null, null);
        assertThat(response.getStatus()).isEqualTo(404);
        assertThat(response.getContentAsString()).isEqualTo("{\"code\":\"NOT_FOUND\",\"message\":\"Not found.\"}");
    }
}
