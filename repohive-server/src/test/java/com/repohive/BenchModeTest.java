package com.repohive;

import static com.repohive.support.Http.cookiePair;
import static com.repohive.support.Http.credentials;
import static com.repohive.support.Http.freshEmail;
import static com.repohive.support.Http.freshIp;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.model.PrecheckResult;
import com.repohive.support.Http;
import com.repohive.support.Seed;
import com.repohive.support.TestEnv;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** An account flagged for benchmarking, through the admin API and through real index requests. */
class BenchModeTest extends JobTestBase {

    static final ObjectMapper JSON = new ObjectMapper();

    @BeforeEach
    void answerForAnyRepo() {
        precheck.answer = text -> new PrecheckResult.Accepted("github.com/" + text, "c0ffee", "S", SNAPSHOT, 1, 1, false);
    }

    private Map<String, String> admin() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", "Bearer " + TestEnv.ADMIN_TOKEN);
        headers.put("Content-Type", "application/json");
        headers.put("X-Forwarded-For", "203.0.113.7");
        return headers;
    }

    private Http.Resp enable(String email, Object hours) throws Exception {
        String body = hours == null ? "{\"email\":\"" + email + "\"}" : "{\"email\":\"" + email + "\",\"hours\":" + hours + "}";
        return http.send("PUT", "/api/admin/bench", body, admin());
    }

    private Http.Resp disable(String email) throws Exception {
        return http.send("DELETE", "/api/admin/bench?email=" + email, null, admin());
    }

    private static JsonNode json(Http.Resp response) throws Exception {
        return JSON.readTree(response.body());
    }

    private String accountId(String email) {
        return jdbc.queryForObject("SELECT id FROM accounts WHERE email = ?", String.class, email);
    }

    private String newAccountEmail() throws Exception {
        String email = freshEmail();
        assertThat(http.post("/api/auth/sign-up", credentials(email, "1234567890"), freshIp(), null).getStatus()).isEqualTo(201);
        return email;
    }

    private String signIn(String email, String ip) throws Exception {
        return cookiePair(http.post("/api/auth/sign-in", credentials(email, "1234567890"), ip, null));
    }

    private Http.Resp index(String cookie, String ip, String repo) throws Exception {
        return http.post("/api/index", "{\"repo\":\"" + repo + "\"}", ip, cookie);
    }

    // --- the admin API

    @Test
    void theApiNeedsTheAdminToken() throws Exception {
        String email = newAccountEmail();
        assertThat(http.send("GET", "/api/admin/bench", null, Map.of()).getStatus()).isEqualTo(401);
        assertThat(http.send("GET", "/api/admin/bench/accounts", null, bearer(SECRET)).getStatus()).isEqualTo(401);
        assertThat(http.send("PUT", "/api/admin/bench", "{\"email\":\"" + email + "\"}", bearer(SECRET)).getStatus()).isEqualTo(401);
        assertThat(http.send("DELETE", "/api/admin/bench?email=" + email, null, bearer(SECRET)).getStatus()).isEqualTo(401);
        assertThat(json(http.send("GET", "/api/admin/bench", null, admin())).get("active")).isEmpty();
    }

    @Test
    void enablingFlagsTheAccountUntilTheEndTimeAndListsIt() throws Exception {
        String email = newAccountEmail();
        JsonNode body = json(enable(email, null));
        assertThat(body.get("maxHours").asInt()).isEqualTo(72);
        assertThat(body.get("defaultHours").asInt()).isEqualTo(12);
        assertThat(body.get("active")).hasSize(1);
        assertThat(body.get("active").get(0).get("email").asText()).isEqualTo(email);
        assertThat(body.get("active").get(0).get("accountId").asText()).isEqualTo(accountId(email));
        assertThat(body.get("active").get(0).get("enabledAt").asText()).isEqualTo("2026-10-03T12:00:00.000Z");
        // The default is twelve hours.
        assertThat(body.get("active").get(0).get("expiresAt").asText()).isEqualTo("2026-10-04T00:00:00.000Z");
        assertThat(body.get("recent").get(0).get("action").asText()).isEqualTo("ENABLED");
        assertThat(body.get("recent").get(0).get("fromIp").asText()).isEqualTo("203.0.113.7");

        // Flagging again replaces the end time, and the email is matched the way sign-in matches it.
        JsonNode again = json(enable("  " + email.toUpperCase() + " ", 2));
        assertThat(again.get("active")).hasSize(1);
        assertThat(again.get("active").get(0).get("expiresAt").asText()).isEqualTo("2026-10-03T14:00:00.000Z");
        assertThat(json(http.send("GET", "/api/admin/bench", null, admin())).get("active")).hasSize(1);
    }

    @Test
    void theFlagEndsByItselfAndCanBeSwitchedOffAtOnce() throws Exception {
        String email = newAccountEmail();
        enable(email, 1);
        clock.advance(Duration.ofMinutes(59));
        assertThat(json(http.send("GET", "/api/admin/bench", null, admin())).get("active")).hasSize(1);
        clock.advance(Duration.ofMinutes(2));
        assertThat(json(http.send("GET", "/api/admin/bench", null, admin())).get("active")).isEmpty();

        enable(email, 5);
        JsonNode off = json(disable(email));
        assertThat(off.get("active")).isEmpty();
        assertThat(off.get("recent").get(0).get("action").asText()).isEqualTo("DISABLED");
        // Switching off what is not on is answered the same way and writes no second audit row.
        int audit = jdbc.queryForObject("SELECT COUNT(*) FROM bench_audit", Integer.class);
        assertThat(disable(email).getStatus()).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM bench_audit", Integer.class)).isEqualTo(audit);
    }

    @Test
    void badRequestsChangeNothing() throws Exception {
        String email = newAccountEmail();
        for (Object hours : List.of(0, -1, 73, 1.5, "\"6\"", true)) {
            assertThat(enable(email, hours).getStatus()).as(String.valueOf(hours)).isEqualTo(400);
        }
        assertThat(enable(email, 72).getStatus()).isEqualTo(200);
        disable(email);
        for (String raw : List.of("", "nope", "[]", "{}", "{\"email\":5}", "{\"email\":\"\"}")) {
            assertThat(http.send("PUT", "/api/admin/bench", raw, admin()).getStatus()).as(raw).isEqualTo(400);
        }
        assertThat(enable("nobody-here@example.com", null).getStatus()).isEqualTo(404);
        assertThat(json(enable("nobody-here@example.com", null)).get("code").asText()).isEqualTo("ACCOUNT_NOT_FOUND");
        assertThat(disable("nobody-here@example.com").getStatus()).isEqualTo(404);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM bench_accounts", Integer.class)).isZero();
    }

    @Test
    void searchFindsAccountsAndShowsWhoIsFlagged() throws Exception {
        String flagged = newAccountEmail();
        String plain = newAccountEmail();
        enable(flagged, 3);
        JsonNode all = json(http.send("GET", "/api/admin/bench/accounts", null, admin()));
        assertThat(all.get("accounts").size()).isBetween(2, 20);

        JsonNode one = json(http.send("GET", "/api/admin/bench/accounts?q=" + flagged.substring(0, flagged.indexOf('@')), null, admin()));
        assertThat(one.get("accounts")).hasSize(1);
        assertThat(one.get("accounts").get(0).get("email").asText()).isEqualTo(flagged);
        assertThat(one.get("accounts").get(0).get("benchUntil").asText()).isEqualTo("2026-10-03T15:00:00.000Z");
        JsonNode other = json(http.send("GET", "/api/admin/bench/accounts?q=" + plain, null, admin()));
        assertThat(other.get("accounts").get(0).get("benchUntil").isNull()).isTrue();

        // LIKE wildcards in the search text are plain characters.
        jdbc.update("UPDATE accounts SET email = 'fifty%pct@example.com' WHERE email = ?", plain);
        assertThat(json(http.send("GET", "/api/admin/bench/accounts?q=%25", null, admin())).get("accounts")).hasSize(1);
        assertThat(json(http.send("GET", "/api/admin/bench/accounts?q=_", null, admin())).get("accounts")).isEmpty();

        clock.advance(Duration.ofHours(4));
        JsonNode ended = json(http.send("GET", "/api/admin/bench/accounts?q=" + flagged, null, admin()));
        assertThat(ended.get("accounts").get(0).get("benchUntil").isNull()).isTrue();
    }

    // --- what the flag changes

    @Test
    void aFlaggedAccountRunsManyIndexesAtOnceAndOrdinaryAccountsAreUntouched() throws Exception {
        String benchEmail = newAccountEmail();
        String ordinaryEmail = newAccountEmail();
        String ip = freshIp(); // one address for both, as on a benchmark machine
        String benchCookie = signIn(benchEmail, ip);
        String ordinaryCookie = signIn(ordinaryEmail, ip);
        enable(benchEmail, 6);

        // Far past five a day, ten per address, one at a time and the global cap of five: nine accepted at once.
        for (int i = 0; i < 9; i++) {
            Http.Resp response = index(benchCookie, ip, "acme/repo" + i);
            assertThat(response.getStatus()).as("request " + i).isEqualTo(202);
        }
        assertThat(dispatch.started).hasSize(9);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM index_charges WHERE ip = 'bench'", Integer.class)).isEqualTo(9);
        // The benchmark did not use up the address: an ordinary account on it asks for an index. The global cap of five
        // is full of benchmark jobs, so it is told to retry rather than charged (that cap still protects everyone).
        Http.Resp ordinary = index(ordinaryCookie, ip, "acme/other");
        assertThat(ordinary.getStatus()).isEqualTo(503);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM index_charges WHERE account_id = ?", Integer.class, accountId(ordinaryEmail))).isZero();
    }

    @Test
    void anOrdinaryAccountOnTheSameAddressKeepsItsOwnQuota() throws Exception {
        String benchEmail = newAccountEmail();
        String ordinaryEmail = newAccountEmail();
        String ip = freshIp();
        String benchCookie = signIn(benchEmail, ip);
        String ordinaryCookie = signIn(ordinaryEmail, ip);
        enable(benchEmail, 6);
        runtimeLimits.update(Map.of(com.repohive.service.RuntimeLimits.Limit.IN_FLIGHT_CAP, 50), "test");

        for (int i = 0; i < 12; i++) {
            assertThat(index(benchCookie, ip, "acme/repo" + i).getStatus()).as("bench " + i).isEqualTo(202);
        }
        // Twelve benchmark charges from this address, and the ordinary account is still let in (the address limit is 10).
        assertThat(index(ordinaryCookie, ip, "acme/ordinary").getStatus()).isEqualTo(202);
        // ...and is held to one at a time like anyone else.
        Http.Resp second = index(ordinaryCookie, ip, "acme/ordinary-second");
        assertThat(second.getStatus()).isEqualTo(429);
        assertThat(second.getContentAsString()).contains("INFLIGHT");
    }

    @Test
    void theFlagsEndRestoresEveryLimit() throws Exception {
        String email = newAccountEmail();
        String ip = freshIp();
        String cookie = signIn(email, ip);
        runtimeLimits.update(Map.of(com.repohive.service.RuntimeLimits.Limit.IN_FLIGHT_CAP, 50), "test");
        enable(email, 1);
        assertThat(index(cookie, ip, "acme/one").getStatus()).isEqualTo(202);
        assertThat(index(cookie, ip, "acme/two").getStatus()).isEqualTo(202);

        clock.advance(Duration.ofHours(2));
        Http.Resp blocked = index(cookie, ip, "acme/three");
        assertThat(blocked.getStatus()).isEqualTo(429);
        assertThat(blocked.getContentAsString()).contains("INFLIGHT");

        enable(email, 1);
        assertThat(index(cookie, ip, "acme/three").getStatus()).isEqualTo(202);
        disable(email);
        assertThat(index(cookie, ip, "acme/four").getStatus()).isEqualTo(429);
    }

    @Test
    void precheckLimitsDoNotApplyEither() throws Exception {
        String email = newAccountEmail();
        String ip = freshIp();
        String cookie = signIn(email, ip);
        // Rejected by the pre-check each time: only the pre-check rate limit is in play.
        precheck.answer = text -> new PrecheckResult.Rejected("NOT_FOUND", "No such repository.");
        for (int i = 0; i < 25; i++) {
            Http.Resp response = index(cookie, ip, "acme/missing" + i);
            if (i < 20) {
                assertThat(response.getStatus()).isEqualTo(422);
            } else {
                assertThat(response.getStatus()).as("ordinary, request " + i).isEqualTo(429);
                break;
            }
        }
        enable(email, 1);
        for (int i = 0; i < 60; i++) {
            assertThat(index(cookie, ip, "acme/missing-b" + i).getStatus()).as("bench " + i).isEqualTo(422);
        }
    }

    @Test
    void seededJobsStillCountTowardTheCapForAnOrdinaryAccount() throws Exception {
        // Guards the opposite direction: the flag must not leak to accounts that are not flagged.
        String email = newAccountEmail();
        String ip = freshIp();
        String cookie = signIn(email, ip);
        for (int i = 0; i < 5; i++) {
            Seed.job(jdbc, clock.instant(), Seed.account(jdbc), "github.com/x/r" + i, "S");
        }
        assertThat(index(cookie, ip, "acme/blocked").getStatus()).isEqualTo(503);
        enable(email, 1);
        assertThat(index(cookie, ip, "acme/allowed").getStatus()).isEqualTo(202);
    }
}
