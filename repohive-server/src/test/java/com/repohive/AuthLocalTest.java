package com.repohive;

import static com.repohive.support.Http.cookiePair;
import static com.repohive.support.Http.credentials;
import static com.repohive.support.Http.freshEmail;
import static com.repohive.support.Http.freshIp;
import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.support.Http;
import com.repohive.support.TestClock;
import com.repohive.support.TestClockConfig;
import com.repohive.support.TestEnv;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.boot.test.web.server.LocalServerPort;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestClockConfig.class)
@ExtendWith(OutputCaptureExtension.class)
class AuthLocalTest {

    static final Path DIR = TestEnv.tempDir();

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        TestEnv.local(registry, DIR);
    }

    @LocalServerPort int port;
    @Autowired TestClock clock;
    @Autowired JdbcTemplate jdbc;

    Http http;

    @BeforeEach
    void setUp() {
        clock.reset();
        http = new Http(port, TestEnv.LOCAL_ORIGIN, "X-Forwarded-For");
    }

    private static final String PASSWORD = "1234567890";

    @Test
    void signUpCreatesAnAccountAndSetsTheExactCookie(CapturedOutput output) throws Exception {
        Http.Resp response = http.post("/api/auth/sign-up", credentials("  New@Example.com ", PASSWORD), freshIp(), null);
        assertThat(response.getStatus()).isEqualTo(201);
        assertThat(response.getContentAsString()).isEqualTo("{\"ok\":true}");
        assertThat(response.getHeader("Content-Type")).isEqualToIgnoringWhitespace("application/json;charset=utf-8");
        // Clock is 2026-10-03T12:00:00Z; the session lasts 30 days.
        assertThat(response.getHeader("Set-Cookie"))
                .matches("repohive_session=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; SameSite=Lax; Expires=Mon, 02 Nov 2026 12:00:00 GMT");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE email = 'new@example.com'", Integer.class)).isEqualTo(1);
        assertThat(output.getOut()).contains("\"SignUps\":1").contains("\"Namespace\":\"RepoHIVE/Hosted\"");
    }

    @Test
    void sessionIsStoredOnlyAsAHashAndStoredFormatsAreTheDocumentedOnes() throws Exception {
        String email = freshEmail();
        Http.Resp response = http.post("/api/auth/sign-up", credentials(email, PASSWORD), freshIp(), null);
        String token = cookiePair(response).substring("repohive_session=".length());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM sessions WHERE token_hash = ?", Integer.class, token)).isZero();
        String hash = com.repohive.service.SessionTokens.hash(token);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM sessions WHERE token_hash = ?", Integer.class, hash)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT expires_at FROM sessions WHERE token_hash = ?", String.class, hash))
                .isEqualTo("2026-11-02T12:00:00.000Z");
        var row = jdbc.queryForMap("SELECT * FROM accounts WHERE email = ?", email);
        assertThat(row.get("id").toString()).matches("[0-9a-f]{32}");
        assertThat(row.get("password_salt").toString()).matches("[0-9a-f]{32}");
        assertThat(row.get("password_hash").toString()).matches("[0-9a-f]{128}");
        assertThat(row.get("created_at")).isEqualTo("2026-10-03T12:00:00.000Z");
        assertThat(row.get("created_utc_day")).isEqualTo("2026-10-03");
    }

    @Test
    void signUpRejectsBadInput() throws Exception {
        Http.Resp email = http.post("/api/auth/sign-up", credentials("not-an-email", PASSWORD), freshIp(), null);
        assertThat(email.getStatus()).isEqualTo(400);
        assertThat(email.getContentAsString()).isEqualTo("{\"code\":\"INVALID_EMAIL\",\"message\":\"Enter a valid email address.\"}");

        Http.Resp shortPassword = http.post("/api/auth/sign-up", credentials(freshEmail(), "short"), freshIp(), null);
        assertThat(shortPassword.getStatus()).isEqualTo(400);
        assertThat(shortPassword.getContentAsString())
                .isEqualTo("{\"code\":\"INVALID_PASSWORD\",\"message\":\"Password must be 10 to 256 characters.\"}");
        Http.Resp longPassword = http.post("/api/auth/sign-up", credentials(freshEmail(), "x".repeat(257)), freshIp(), null);
        assertThat(longPassword.getStatus()).isEqualTo(400);
        Http.Resp longestAllowed = http.post("/api/auth/sign-up", credentials(freshEmail(), "x".repeat(256)), freshIp(), null);
        assertThat(longestAllowed.getStatus()).isEqualTo(201);
    }

    @Test
    void unparseableOrIncompleteBodiesAre400BadRequest() throws Exception {
        String expected = "{\"code\":\"BAD_REQUEST\",\"message\":\"Expected email and password.\"}";
        for (String path : new String[] {"/api/auth/sign-up", "/api/auth/sign-in"}) {
            for (String body : new String[] {"", "not json", "{}", "[]", "null", "{\"email\":\"a@b.co\"}", "{\"email\":1,\"password\":\"x\"}"}) {
                Http.Resp response = http.post(path, body, freshIp(), null);
                assertThat(response.getStatus()).as(path + " " + body).isEqualTo(400);
                assertThat(response.getContentAsString()).isEqualTo(expected);
            }
        }
    }

    @Test
    void duplicateEmailIs409() throws Exception {
        String email = freshEmail();
        http.post("/api/auth/sign-up", credentials(email, PASSWORD), freshIp(), null);
        Http.Resp again = http.post("/api/auth/sign-up", credentials(email.toUpperCase(), PASSWORD), freshIp(), null);
        assertThat(again.getStatus()).isEqualTo(409);
        assertThat(again.getContentAsString())
                .isEqualTo("{\"code\":\"EMAIL_TAKEN\",\"message\":\"An account with this email already exists.\"}");
        assertThat(again.getHeader("Set-Cookie")).isNull();
    }

    @Test
    void fourthSignUpFromOneIpInADayIs429AndANewDayResets() throws Exception {
        String ip = freshIp();
        for (int i = 0; i < 3; i++) {
            assertThat(http.post("/api/auth/sign-up", credentials(freshEmail(), PASSWORD), ip, null).getStatus()).isEqualTo(201);
        }
        Http.Resp blocked = http.post("/api/auth/sign-up", credentials(freshEmail(), PASSWORD), ip, null);
        assertThat(blocked.getStatus()).isEqualTo(429);
        assertThat(blocked.getContentAsString())
                .isEqualTo("{\"code\":\"SIGNUP_IP_LIMIT\",\"message\":\"Too many accounts were created from this network today.\"}");
        // Another address is unaffected.
        assertThat(http.post("/api/auth/sign-up", credentials(freshEmail(), PASSWORD), freshIp(), null).getStatus()).isEqualTo(201);
        // The count is per UTC day.
        clock.advance(Duration.ofDays(1));
        assertThat(http.post("/api/auth/sign-up", credentials(freshEmail(), PASSWORD), ip, null).getStatus()).isEqualTo(201);
    }

    @Test
    void signInSucceedsWithNormalisedEmailAndSetsACookie() throws Exception {
        String email = freshEmail();
        http.post("/api/auth/sign-up", credentials(email, PASSWORD), freshIp(), null);
        Http.Resp response = http.post("/api/auth/sign-in", credentials(" " + email.toUpperCase() + " ", PASSWORD), freshIp(), null);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsString()).isEqualTo("{\"ok\":true}");
        assertThat(response.getHeader("Set-Cookie")).startsWith("repohive_session=").endsWith("Expires=Mon, 02 Nov 2026 12:00:00 GMT");
    }

    @Test
    void wrongPasswordAndUnknownEmailGetTheSameGenericAnswer() throws Exception {
        String email = freshEmail();
        http.post("/api/auth/sign-up", credentials(email, PASSWORD), freshIp(), null);
        String expected = "{\"code\":\"SIGNIN_REJECTED\",\"message\":\"Invalid email or password.\"}";
        Http.Resp wrong = http.post("/api/auth/sign-in", credentials(email, "wrong-password"), freshIp(), null);
        Http.Resp unknown = http.post("/api/auth/sign-in", credentials(freshEmail(), PASSWORD), freshIp(), null);
        assertThat(wrong.getStatus()).isEqualTo(401);
        assertThat(wrong.getContentAsString()).isEqualTo(expected);
        assertThat(unknown.getStatus()).isEqualTo(401);
        assertThat(unknown.getContentAsString()).isEqualTo(expected);
        assertThat(wrong.getHeader("Set-Cookie")).isNull();
    }

    @Test
    void accountIsLockedOnTheSixthAttemptAfterFiveFailuresAndUnlocksAfterFifteenMinutes() throws Exception {
        String email = freshEmail();
        http.post("/api/auth/sign-up", credentials(email, PASSWORD), freshIp(), null);
        for (int i = 0; i < 5; i++) {
            // A different address each time: only the account counter can lock this.
            assertThat(http.post("/api/auth/sign-in", credentials(email, "wrong-password"), freshIp(), null).getStatus()).isEqualTo(401);
        }
        Http.Resp locked = http.post("/api/auth/sign-in", credentials(email, PASSWORD), freshIp(), null);
        assertThat(locked.getStatus()).isEqualTo(429);
        assertThat(locked.getContentAsString())
                .isEqualTo("{\"code\":\"SIGNIN_LOCKED\",\"message\":\"Too many sign-in attempts. Try again later.\"}");

        clock.advance(Duration.ofMinutes(14));
        assertThat(http.post("/api/auth/sign-in", credentials(email, PASSWORD), freshIp(), null).getStatus()).isEqualTo(429);
        clock.advance(Duration.ofMinutes(2));
        assertThat(http.post("/api/auth/sign-in", credentials(email, PASSWORD), freshIp(), null).getStatus()).isEqualTo(200);
    }

    @Test
    void ipIsLockedAfterTwentyFailures() throws Exception {
        String email = freshEmail();
        http.post("/api/auth/sign-up", credentials(email, PASSWORD), freshIp(), null);
        String ip = freshIp();
        for (int i = 0; i < 20; i++) {
            assertThat(http.post("/api/auth/sign-in", credentials(freshEmail(), "wrong-password"), ip, null).getStatus()).isEqualTo(401);
        }
        Http.Resp locked = http.post("/api/auth/sign-in", credentials(email, PASSWORD), ip, null);
        assertThat(locked.getStatus()).isEqualTo(429);
        assertThat(locked.getContentAsString()).contains("SIGNIN_LOCKED");
        assertThat(http.post("/api/auth/sign-in", credentials(email, PASSWORD), freshIp(), null).getStatus()).isEqualTo(200);
    }

    @Test
    void signOutDeletesTheSessionAndClearsTheCookie() throws Exception {
        String email = freshEmail();
        Http.Resp signUp = http.post("/api/auth/sign-up", credentials(email, PASSWORD), freshIp(), null);
        String cookie = cookiePair(signUp);
        assertThat(http.get("/api/auth/session", null, cookie).getContentAsString()).isEqualTo("{\"signedIn\":true,\"email\":\"" + email + "\"}");

        Http.Resp out = http.post("/api/auth/sign-out", "", null, cookie);
        assertThat(out.getStatus()).isEqualTo(200);
        assertThat(out.getContentAsString()).isEqualTo("{\"ok\":true}");
        assertThat(out.getHeader("Set-Cookie")).isEqualTo("repohive_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
        assertThat(http.get("/api/auth/session", null, cookie).getContentAsString()).isEqualTo("{\"signedIn\":false}");

        Http.Resp withoutSession = http.post("/api/auth/sign-out", "", null, null);
        assertThat(withoutSession.getStatus()).isEqualTo(200);
        assertThat(withoutSession.getHeader("Set-Cookie")).contains("Max-Age=0");
    }

    @Test
    void sessionProbeHasTwoShapesAndNeverReturns401() throws Exception {
        Http.Resp anonymous = http.get("/api/auth/session", null, null);
        assertThat(anonymous.getStatus()).isEqualTo(200);
        assertThat(anonymous.getContentAsString()).isEqualTo("{\"signedIn\":false}");
        assertThat(anonymous.getHeader("Content-Type")).isEqualToIgnoringWhitespace("application/json;charset=utf-8");
        Http.Resp garbage = http.get("/api/auth/session", null, "other=1; repohive_session=nonsense");
        assertThat(garbage.getContentAsString()).isEqualTo("{\"signedIn\":false}");

        String email = freshEmail();
        String cookie = cookiePair(http.post("/api/auth/sign-up", credentials(email, PASSWORD), freshIp(), null));
        Http.Resp signedIn = http.get("/api/auth/session", null, "a=b; " + cookie + "; c=d");
        assertThat(signedIn.getStatus()).isEqualTo(200);
        assertThat(signedIn.getContentAsString()).isEqualTo("{\"signedIn\":true,\"email\":\"" + email + "\"}");
    }

    @Test
    void anExpiredSessionIsDeletedAndTreatedAsSignedOut() throws Exception {
        String cookie = cookiePair(http.post("/api/auth/sign-up", credentials(freshEmail(), PASSWORD), freshIp(), null));
        int before = jdbc.queryForObject("SELECT COUNT(*) FROM sessions", Integer.class);
        clock.advance(Duration.ofDays(30).minusSeconds(1));
        assertThat(http.get("/api/auth/session", null, cookie).getContentAsString()).contains("\"signedIn\":true");
        clock.advance(Duration.ofSeconds(1));
        assertThat(http.get("/api/auth/session", null, cookie).getContentAsString()).isEqualTo("{\"signedIn\":false}");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM sessions", Integer.class)).isEqualTo(before - 1);
    }

    @Test
    void everyPostChecksTheOriginFirst() throws Exception {
        String origin403 = "{\"code\":\"ORIGIN_REJECTED\",\"message\":\"Origin not allowed.\"}";
        for (String path : new String[] {"/api/auth/sign-up", "/api/auth/sign-in", "/api/auth/sign-out"}) {
            // Even a body that would be a 400 is answered with 403 first.
            Http.Resp missing = http.post(path, "garbage", freshIp(), null, null, false);
            assertThat(missing.getStatus()).as(path).isEqualTo(403);
            assertThat(missing.getContentAsString()).isEqualTo(origin403);
            Http.Resp wrong = http.post(path, credentials(freshEmail(), PASSWORD), freshIp(), null, "http://evil.example", true);
            assertThat(wrong.getStatus()).as(path).isEqualTo(403);
            assertThat(wrong.getContentAsString()).isEqualTo(origin403);
            Http.Resp slash = http.post(path, credentials(freshEmail(), PASSWORD), freshIp(), null, TestEnv.LOCAL_ORIGIN + "/", true);
            assertThat(slash.getStatus()).as(path).isEqualTo(403);
        }
    }

    @Test
    void localModeClientIpIsTheFirstForwardedEntryThenRealIpThenLoopback() throws Exception {
        String ip = freshIp();
        for (int i = 0; i < 3; i++) {
            http.post("/api/auth/sign-up", credentials(freshEmail(), PASSWORD), ip + " , 10.9.9.9", null);
        }
        // Same first entry, different tail: still the same client.
        assertThat(http.post("/api/auth/sign-up", credentials(freshEmail(), PASSWORD), ip + ", 10.8.8.8", null).getStatus()).isEqualTo(429);

        // X-Real-IP is used when there is no X-Forwarded-For.
        String real = freshIp();
        Map<String, String> realHeaders = Map.of("Origin", TestEnv.LOCAL_ORIGIN, "X-Real-IP", real);
        for (int i = 0; i < 3; i++) {
            http.send("POST", "/api/auth/sign-up", credentials(freshEmail(), PASSWORD), realHeaders);
        }
        Http.Resp blocked = http.send("POST", "/api/auth/sign-up", credentials(freshEmail(), PASSWORD), realHeaders);
        assertThat(blocked.getStatus()).isEqualTo(429);

        // No headers at all: 127.0.0.1, whatever the socket says.
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE created_ip = '127.0.0.1'", Integer.class)).isZero();
        http.post("/api/auth/sign-up", credentials(freshEmail(), PASSWORD), null, null);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE created_ip = '127.0.0.1'", Integer.class)).isEqualTo(1);
    }
}
