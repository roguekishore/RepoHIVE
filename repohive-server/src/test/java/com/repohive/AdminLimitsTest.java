package com.repohive;

import static com.repohive.support.Http.cookiePair;
import static com.repohive.support.Http.credentials;
import static com.repohive.support.Http.freshEmail;
import static com.repohive.support.Http.freshIp;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.config.AppConfig;
import com.repohive.model.QuotaRejectCode;
import com.repohive.model.QuotaResult;
import com.repohive.repository.SettingsRepository;
import com.repohive.service.QuotaService;
import com.repohive.service.RuntimeLimits;
import com.repohive.support.Http;
import com.repohive.support.TestClock;
import com.repohive.support.TestClockConfig;
import com.repohive.support.TestEnv;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestClockConfig.class)
class AdminLimitsTest {

    static final Path DIR = TestEnv.tempDir();
    static final String PATH = "/api/admin/limits";
    static final ObjectMapper JSON = new ObjectMapper();

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        TestEnv.local(registry, DIR);
        TestEnv.admin(registry);
    }

    @LocalServerPort int port;
    @Autowired TestClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired RuntimeLimits limits;
    @Autowired QuotaService quota;
    @Autowired SettingsRepository settings;
    @Autowired AppConfig config;
    @Autowired PlatformTransactionManager txManager;

    Http http;

    @BeforeEach
    void setUp() throws Exception {
        clock.reset();
        http = new Http(port, TestEnv.LOCAL_ORIGIN, "X-Forwarded-For");
        // The context is shared by every test here: drop what the last one saved.
        Map<String, Object> reset = new LinkedHashMap<>();
        for (RuntimeLimits.Limit limit : RuntimeLimits.Limit.values()) {
            reset.put(limit.key(), null);
        }
        assertThat(put(reset).getStatus()).isEqualTo(200);
        jdbc.update("DELETE FROM settings_audit");
    }

    private static Map<String, String> headers(String token) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        if (token != null) {
            headers.put("Authorization", "Bearer " + token);
        }
        return headers;
    }

    private Http.Resp get() throws Exception {
        return http.send("GET", PATH, null, headers(TestEnv.ADMIN_TOKEN));
    }

    private Http.Resp putRaw(String body, Map<String, String> headers) throws Exception {
        return http.send("PUT", PATH, body, headers);
    }

    private Http.Resp put(Map<String, Object> values) throws Exception {
        Map<String, String> headers = headers(TestEnv.ADMIN_TOKEN);
        headers.put("X-Forwarded-For", "203.0.113.7");
        return putRaw(JSON.writeValueAsString(Map.of("limits", values)), headers);
    }

    private static JsonNode body(Http.Resp response) throws Exception {
        return JSON.readTree(response.body());
    }

    private static JsonNode entry(JsonNode body, String key) {
        for (JsonNode limit : body.get("limits")) {
            if (limit.get("key").asText().equals(key)) {
                return limit;
            }
        }
        throw new AssertionError("no limit " + key);
    }

    private String newAccount() {
        String id = UUID.randomUUID().toString().replace("-", "");
        jdbc.update(
                "INSERT INTO accounts (id, email, password_salt, password_hash, scrypt_n, scrypt_r, scrypt_p,"
                        + " created_at, created_utc_day, created_ip) VALUES (?, ?, 'aa', 'bb', 16384, 8, 1, ?, ?, '1.1.1.1')",
                id, id + "@example.com", "2026-10-03T12:00:00.000Z", "2026-10-03");
        return id;
    }

    private QuotaResult reserve(String accountId, String ip, String jobId) {
        return new TransactionTemplate(txManager).execute(status -> quota.reserveCharge(accountId, ip, jobId));
    }

    // --- who may call it

    @Test
    void aRequestWithoutTheTokenIsRefused() throws Exception {
        for (Map<String, String> headers : List.of(
                headers(null),
                headers("wrong-token-wrong-token-wrong-token"),
                // The worker's secret is not the admin token.
                headers(config.internalSecret()),
                Map.of("Authorization", "Basic " + TestEnv.ADMIN_TOKEN))) {
            Http.Resp get = http.send("GET", PATH, null, headers);
            assertThat(get.getStatus()).isEqualTo(401);
            assertThat(get.getContentAsString()).isEqualTo("{\"code\":\"UNAUTHORIZED\",\"message\":\"Unauthorized.\"}");
            assertThat(get.getHeader("WWW-Authenticate")).isEqualTo("Bearer");
            assertThat(putRaw("{\"limits\":{\"inFlightCap\":9}}", headers).getStatus()).isEqualTo(401);
        }
        assertThat(entry(body(get()), "inFlightCap").get("overridden").asBoolean()).isFalse();
    }

    @Test
    void theRouteIsNotBehindTheSessionOriginGuardAndIsNeverCached() throws Exception {
        // No Origin header at all: the guard on the session routes would answer 403.
        Http.Resp noOrigin = get();
        assertThat(noOrigin.getStatus()).isEqualTo(200);
        assertThat(noOrigin.getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(noOrigin.getHeader("Content-Type")).isEqualToIgnoringWhitespace("application/json;charset=utf-8");
    }

    // --- reading

    @Test
    void getListsEverySixLimitsWithDefaultsAndBounds() throws Exception {
        JsonNode body = body(get());
        assertThat(body.get("limits")).hasSize(6);
        JsonNode account = entry(body, "acceptedPerAccountPerDay");
        assertThat(account.get("value").asInt()).isEqualTo(5);
        assertThat(account.get("defaultValue").asInt()).isEqualTo(5);
        assertThat(account.get("overridden").asBoolean()).isFalse();
        assertThat(account.get("min").asInt()).isEqualTo(1);
        assertThat(account.get("max").asInt()).isEqualTo(100);
        assertThat(entry(body, "acceptedPerIpPerDay").get("value").asInt()).isEqualTo(10);
        assertThat(entry(body, "prechecksPerAccountPerHour").get("value").asInt()).isEqualTo(20);
        assertThat(entry(body, "prechecksPerIpPerHour").get("value").asInt()).isEqualTo(40);
        assertThat(entry(body, "inFlightCap").get("value").asInt()).isEqualTo(5);
        assertThat(entry(body, "signUpsPerIpPerDay").get("value").asInt()).isEqualTo(3);
        assertThat(body.has("lastChange")).isFalse();
        assertThat(body.get("recent")).isEmpty();
        assertThat(body.has("changes")).isFalse();
    }

    // --- writing

    @Test
    void putSavesAnOverrideReportsTheChangeAndAuditsIt() throws Exception {
        Http.Resp response = put(Map.of("acceptedPerAccountPerDay", 8));
        assertThat(response.getStatus()).isEqualTo(200);
        JsonNode body = body(response);
        assertThat(entry(body, "acceptedPerAccountPerDay").get("value").asInt()).isEqualTo(8);
        assertThat(entry(body, "acceptedPerAccountPerDay").get("overridden").asBoolean()).isTrue();
        assertThat(entry(body, "acceptedPerAccountPerDay").get("defaultValue").asInt()).isEqualTo(5);
        assertThat(body.get("changes")).hasSize(1);
        assertThat(body.get("changes").get(0).get("oldValue").asInt()).isEqualTo(5);
        assertThat(body.get("changes").get(0).get("newValue").asInt()).isEqualTo(8);
        assertThat(body.get("clamped")).isEmpty();

        JsonNode last = body(get()).get("lastChange");
        assertThat(last.get("key").asText()).isEqualTo("acceptedPerAccountPerDay");
        assertThat(last.get("oldValue").asInt()).isEqualTo(5);
        assertThat(last.get("newValue").asInt()).isEqualTo(8);
        assertThat(last.get("changedAt").asText()).isEqualTo("2026-10-03T12:00:00.000Z");
        assertThat(last.get("fromIp").asText()).isEqualTo("203.0.113.7");
    }

    @Test
    void aValueAboveTheMaximumIsClampedAndSaidSo() throws Exception {
        JsonNode body = body(put(Map.of("inFlightCap", 100000, "acceptedPerIpPerDay", 11)));
        assertThat(entry(body, "inFlightCap").get("value").asInt()).isEqualTo(50);
        assertThat(entry(body, "acceptedPerIpPerDay").get("value").asInt()).isEqualTo(11);
        assertThat(body.get("clamped")).hasSize(1);
        assertThat(body.get("clamped").get(0).asText()).isEqualTo("inFlightCap");
        // Larger than an int: still clamped, not an error.
        assertThat(entry(body(put(Map.of("signUpsPerIpPerDay", 99999999999L))), "signUpsPerIpPerDay").get("value").asInt())
                .isEqualTo(100);
    }

    @Test
    void nullGoesBackToTheDefaultAndAnUnchangedValueWritesNoAuditRow() throws Exception {
        put(Map.of("prechecksPerIpPerHour", 60));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM settings_audit", Integer.class)).isEqualTo(1);

        // The same value again changes nothing.
        JsonNode same = body(put(Map.of("prechecksPerIpPerHour", 60)));
        assertThat(same.get("changes")).isEmpty();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM settings_audit", Integer.class)).isEqualTo(1);

        Map<String, Object> reset = new LinkedHashMap<>();
        reset.put("prechecksPerIpPerHour", null);
        JsonNode back = body(put(reset));
        JsonNode entry = entry(back, "prechecksPerIpPerHour");
        assertThat(entry.get("value").asInt()).isEqualTo(40);
        assertThat(entry.get("overridden").asBoolean()).isFalse();
        assertThat(back.get("changes").get(0).get("newValue").asInt()).isEqualTo(40);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM settings", Integer.class)).isZero();
        // Resetting something that was never saved is a no-op.
        assertThat(body(put(reset)).get("changes")).isEmpty();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM settings_audit", Integer.class)).isEqualTo(2);
    }

    @Test
    void aBadRequestChangesNothingNotEvenItsValidPart() throws Exception {
        Map<String, Map<String, Object>> bad = new LinkedHashMap<>();
        bad.put("zero", Map.of("inFlightCap", 0));
        bad.put("negative", Map.of("inFlightCap", -3));
        bad.put("fraction", Map.of("inFlightCap", 2.5));
        bad.put("text", Map.of("inFlightCap", "7"));
        bad.put("boolean", Map.of("inFlightCap", true));
        bad.put("unknown", Map.of("noSuchLimit", 4));
        for (Map.Entry<String, Map<String, Object>> request : bad.entrySet()) {
            Map<String, Object> mixed = new LinkedHashMap<>();
            mixed.put("acceptedPerAccountPerDay", 9);
            mixed.putAll(request.getValue());
            Http.Resp response = put(mixed);
            assertThat(response.getStatus()).as(request.getKey()).isEqualTo(400);
            assertThat(body(response).get("code").asText()).isEqualTo("BAD_REQUEST");
        }
        for (String raw : List.of("", "not json", "[]", "{}", "{\"limits\":{}}", "{\"limits\":[]}", "{\"limits\":5}")) {
            assertThat(putRaw(raw, headers(TestEnv.ADMIN_TOKEN)).getStatus()).as(raw).isEqualTo(400);
        }
        JsonNode after = body(get());
        assertThat(entry(after, "acceptedPerAccountPerDay").get("overridden").asBoolean()).isFalse();
        assertThat(entry(after, "inFlightCap").get("overridden").asBoolean()).isFalse();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM settings_audit", Integer.class)).isZero();
    }

    @Test
    void anOversizedBodyIsRefused() throws Exception {
        String huge = "{\"limits\":{\"inFlightCap\":3},\"pad\":\"" + "x".repeat(70 * 1024) + "\"}";
        assertThat(putRaw(huge, headers(TestEnv.ADMIN_TOKEN)).getStatus()).isEqualTo(413);
    }

    // --- the services follow the saved values

    @Test
    void theQuotaChecksUseTheSavedValuesAtOnce() throws Exception {
        String account = newAccount();
        String ip = freshIp();
        put(Map.of("acceptedPerAccountPerDay", 2));
        assertThat(reserve(account, ip, "a1-" + account).ok()).isTrue();
        assertThat(reserve(account, ip, "a2-" + account).ok()).isTrue();
        assertThat(reserve(account, ip, "a3-" + account).rejection()).isEqualTo(QuotaRejectCode.QUOTA_ACCOUNT);
        put(Map.of("acceptedPerAccountPerDay", 3));
        assertThat(reserve(account, ip, "a3-" + account).ok()).isTrue();

        String other = newAccount();
        String otherIp = freshIp();
        put(Map.of("acceptedPerIpPerDay", 1));
        assertThat(reserve(other, otherIp, "i1-" + other).ok()).isTrue();
        assertThat(reserve(other, otherIp, "i2-" + other).rejection()).isEqualTo(QuotaRejectCode.QUOTA_IP);

        String hourly = newAccount();
        String hourlyIp = freshIp();
        put(Map.of("prechecksPerAccountPerHour", 2));
        assertThat(quota.recordPrecheckAttempt(hourly, hourlyIp).ok()).isTrue();
        assertThat(quota.recordPrecheckAttempt(hourly, hourlyIp).ok()).isTrue();
        assertThat(quota.recordPrecheckAttempt(hourly, hourlyIp).rejection()).isEqualTo(QuotaRejectCode.PRECHECK_ACCOUNT_LIMIT);

        String perIp = newAccount();
        String perIpAddress = freshIp();
        put(Map.of("prechecksPerAccountPerHour", 500, "prechecksPerIpPerHour", 1));
        assertThat(quota.recordPrecheckAttempt(perIp, perIpAddress).ok()).isTrue();
        assertThat(quota.recordPrecheckAttempt(perIp, perIpAddress).rejection()).isEqualTo(QuotaRejectCode.PRECHECK_IP_LIMIT);
    }

    @Test
    void theQuotaEndpointShowsTheSavedLimits() throws Exception {
        String ip = freshIp();
        String cookie = cookiePair(http.post("/api/auth/sign-up", credentials(freshEmail(), "1234567890"), ip, null));
        put(Map.of("acceptedPerAccountPerDay", 7, "acceptedPerIpPerDay", 12));
        assertThat(http.get("/api/quota", ip, cookie).getContentAsString())
                .isEqualTo("{\"remainingAccount\":7,\"remainingIp\":12,\"limitAccount\":7,\"limitIp\":12}");
    }

    @Test
    void theSignUpLimitFollowsTheSavedValue() throws Exception {
        String ip = freshIp();
        put(Map.of("signUpsPerIpPerDay", 4));
        for (int i = 0; i < 4; i++) {
            assertThat(http.post("/api/auth/sign-up", credentials(freshEmail(), "1234567890"), ip, null).getStatus()).isEqualTo(201);
        }
        Http.Resp blocked = http.post("/api/auth/sign-up", credentials(freshEmail(), "1234567890"), ip, null);
        assertThat(blocked.getStatus()).isEqualTo(429);
        assertThat(blocked.getContentAsString()).contains("SIGNUP_IP_LIMIT");
    }

    // --- persistence and the cache

    @Test
    void aSavedValueSurvivesARestartAndBeatsTheEnvironment() throws Exception {
        put(Map.of("inFlightCap", 9));
        // A new instance reads the same database, as a restarted server would.
        RuntimeLimits restarted = new RuntimeLimits(settings, config, clock, txManager);
        assertThat(restarted.current().inFlightCap()).isEqualTo(9);
        assertThat(restarted.current().acceptedPerAccountPerDay()).isEqualTo(config.quota().acceptedPerAccountPerDay());
        assertThat(restarted.defaults()).isEqualTo(config.quota());
    }

    @Test
    void aChangeMadeBehindTheServersBackAppearsAfterTheCacheExpires() {
        assertThat(limits.current().inFlightCap()).isEqualTo(5);
        jdbc.update("INSERT INTO settings (key, value, updated_at) VALUES ('inFlightCap', 12, 't')");
        clock.advance(Duration.ofSeconds(4));
        assertThat(limits.current().inFlightCap()).isEqualTo(5);
        clock.advance(Duration.ofSeconds(2));
        assertThat(limits.current().inFlightCap()).isEqualTo(12);
        jdbc.update("DELETE FROM settings");
    }

    // --- the browser page

    @Test
    void aPageOnAnAllowedOriginMayPreflightAndCall() throws Exception {
        Map<String, String> preflight = new LinkedHashMap<>();
        preflight.put("Origin", TestEnv.ADMIN_ORIGIN);
        preflight.put("Access-Control-Request-Method", "PUT");
        preflight.put("Access-Control-Request-Headers", "authorization,content-type");
        Http.Resp options = http.send("OPTIONS", PATH, null, preflight);
        assertThat(options.getStatus()).isEqualTo(200);
        assertThat(options.getHeader("Access-Control-Allow-Origin")).isEqualTo(TestEnv.ADMIN_ORIGIN);
        assertThat(options.getHeader("Access-Control-Allow-Methods")).contains("PUT").contains("GET");
        assertThat(options.getHeader("Access-Control-Allow-Headers").toLowerCase()).contains("authorization").contains("content-type");

        Map<String, String> call = headers(TestEnv.ADMIN_TOKEN);
        call.put("Origin", TestEnv.ADMIN_ORIGIN);
        Http.Resp put = putRaw("{\"limits\":{\"inFlightCap\":8}}", call);
        assertThat(put.getStatus()).isEqualTo(200);
        assertThat(put.getHeader("Access-Control-Allow-Origin")).isEqualTo(TestEnv.ADMIN_ORIGIN);
        Http.Resp get = http.send("GET", PATH, null, call);
        assertThat(get.getStatus()).isEqualTo(200);
        assertThat(get.getHeader("Access-Control-Allow-Origin")).isEqualTo(TestEnv.ADMIN_ORIGIN);
    }

    @Test
    void anyOtherOriginGetsNoCorsAccess() throws Exception {
        for (String origin : List.of("https://evil.example", TestEnv.LOCAL_ORIGIN, "null")) {
            Map<String, String> preflight = new LinkedHashMap<>();
            preflight.put("Origin", origin);
            preflight.put("Access-Control-Request-Method", "PUT");
            Http.Resp options = http.send("OPTIONS", PATH, null, preflight);
            assertThat(options.getStatus()).as(origin).isEqualTo(403);
            assertThat(options.getHeader("Access-Control-Allow-Origin")).as(origin).isNull();

            Map<String, String> call = headers(TestEnv.ADMIN_TOKEN);
            call.put("Origin", origin);
            Http.Resp put = putRaw("{\"limits\":{\"inFlightCap\":8}}", call);
            assertThat(put.getStatus()).as(origin).isEqualTo(403);
            assertThat(put.getHeader("Access-Control-Allow-Origin")).as(origin).isNull();
        }
        assertThat(entry(body(get()), "inFlightCap").get("overridden").asBoolean()).isFalse();
    }
}
