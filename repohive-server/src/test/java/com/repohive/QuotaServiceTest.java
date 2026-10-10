package com.repohive;

import static com.repohive.support.Http.cookiePair;
import static com.repohive.support.Http.credentials;
import static com.repohive.support.Http.freshEmail;
import static com.repohive.support.Http.freshIp;
import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.model.QuotaRejectCode;
import com.repohive.model.QuotaResult;
import com.repohive.model.RemainingQuota;
import com.repohive.service.QuotaMessages;
import com.repohive.service.QuotaService;
import com.repohive.support.Http;
import com.repohive.support.TestClock;
import com.repohive.support.TestClockConfig;
import com.repohive.support.TestEnv;
import java.nio.file.Path;
import java.time.Duration;
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
class QuotaServiceTest {

    static final Path DIR = TestEnv.tempDir();

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        TestEnv.local(registry, DIR);
    }

    @LocalServerPort int port;
    @Autowired TestClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired QuotaService quota;
    @Autowired PlatformTransactionManager txManager;

    @BeforeEach
    void setUp() {
        clock.reset();
    }

    private String newAccount() {
        String id = UUID.randomUUID().toString().replace("-", "");
        jdbc.update(
                "INSERT INTO accounts (id, email, password_salt, password_hash, scrypt_n, scrypt_r, scrypt_p,"
                        + " created_at, created_utc_day, created_ip) VALUES (?, ?, 'aa', 'bb', 16384, 8, 1, ?, ?, '1.1.1.1')",
                id, id + "@example.com", "2026-10-03T12:00:00.000Z", "2026-10-03");
        return id;
    }

    private void addJob(String accountId, String status) {
        String id = UUID.randomUUID().toString().replace("-", "");
        jdbc.update(
                "INSERT INTO job_executions (id, repo, commit_sha, snapshot_id, account_id, tier, status, state,"
                        + " created_at, queued_at, updated_at) VALUES (?, ?, 'c', 's', ?, 'S', ?, 'queued', 't', 't', 't')",
                id, "github.com/o/" + id, accountId, status);
    }

    private QuotaResult reserve(String accountId, String ip, String jobId) {
        return new TransactionTemplate(txManager).execute(status -> quota.reserveCharge(accountId, ip, jobId));
    }

    @Test
    void precheckAllowsTwentyPerAccountPerHourThenRejectsWithoutCountingTheIp() {
        String account = newAccount();
        String ip = freshIp();
        for (int i = 0; i < 20; i++) {
            assertThat(quota.recordPrecheckAttempt(account, ip).ok()).isTrue();
        }
        QuotaResult blocked = quota.recordPrecheckAttempt(account, ip);
        assertThat(blocked.ok()).isFalse();
        assertThat(blocked.rejection()).isEqualTo(QuotaRejectCode.PRECHECK_ACCOUNT_LIMIT);
        // The rejected attempt is all-or-nothing: the IP bucket still reads 20.
        assertThat(jdbc.queryForObject("SELECT count FROM precheck_hourly WHERE bucket = ?", Integer.class,
                        "ip:" + ip + ":2026-10-03T12"))
                .isEqualTo(20);
        assertThat(jdbc.queryForObject("SELECT count FROM precheck_hourly WHERE bucket = ?", Integer.class,
                        "account:" + account + ":2026-10-03T12"))
                .isEqualTo(20);

        clock.advance(Duration.ofHours(1));
        assertThat(quota.recordPrecheckAttempt(account, ip).ok()).isTrue();
    }

    @Test
    void precheckAllowsFortyPerIpPerHourAndRollsBackTheAccountBucket() {
        String ip = freshIp();
        String a = newAccount();
        String b = newAccount();
        String c = newAccount();
        for (int i = 0; i < 20; i++) {
            assertThat(quota.recordPrecheckAttempt(a, ip).ok()).isTrue();
            assertThat(quota.recordPrecheckAttempt(b, ip).ok()).isTrue();
        }
        QuotaResult blocked = quota.recordPrecheckAttempt(c, ip);
        assertThat(blocked.rejection()).isEqualTo(QuotaRejectCode.PRECHECK_IP_LIMIT);
        assertThat(jdbc.queryForList("SELECT count FROM precheck_hourly WHERE bucket = ?", Integer.class,
                        "account:" + c + ":2026-10-03T12"))
                .isEmpty();
        // Another address is unaffected.
        assertThat(quota.recordPrecheckAttempt(c, freshIp()).ok()).isTrue();
    }

    @Test
    void reserveChargeEnforcesTheAccountDayLimitAndRefundsFreeTheSlot() {
        String account = newAccount();
        String ip = freshIp();
        for (int i = 0; i < 5; i++) {
            assertThat(reserve(account, ip, "job-" + account + i).ok()).isTrue();
        }
        QuotaResult blocked = reserve(account, ip, "job-" + account + "x");
        assertThat(blocked.rejection()).isEqualTo(QuotaRejectCode.QUOTA_ACCOUNT);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM index_charges WHERE job_id = ?", Integer.class, "job-" + account + "x")).isZero();
        assertThat(quota.remaining(account, ip)).isEqualTo(new RemainingQuota(0, 5, 5, 10));

        assertThat(quota.refund("job-" + account + "0")).isTrue();
        assertThat(quota.remaining(account, ip)).isEqualTo(new RemainingQuota(1, 6, 5, 10));
        assertThat(reserve(account, ip, "job-" + account + "y").ok()).isTrue();

        clock.advance(Duration.ofDays(1));
        assertThat(quota.remaining(account, ip)).isEqualTo(new RemainingQuota(5, 10, 5, 10));
    }

    @Test
    void reserveChargeEnforcesTheIpDayLimit() {
        String ip = freshIp();
        for (int i = 0; i < 10; i++) {
            String account = newAccount();
            assertThat(reserve(account, ip, "ipjob-" + account).ok()).isTrue();
        }
        String eleventh = newAccount();
        QuotaResult blocked = reserve(eleventh, ip, "ipjob-" + eleventh);
        assertThat(blocked.rejection()).isEqualTo(QuotaRejectCode.QUOTA_IP);
        assertThat(reserve(eleventh, freshIp(), "ipjob2-" + eleventh).ok()).isTrue();
    }

    @Test
    void anAccountWithAQueuedOrRunningJobIsInFlight() {
        String account = newAccount();
        String ip = freshIp();
        addJob(account, "RUNNING");
        assertThat(reserve(account, ip, "j1-" + account).rejection()).isEqualTo(QuotaRejectCode.INFLIGHT);
        jdbc.update("UPDATE job_executions SET status = 'SUCCEEDED' WHERE account_id = ?", account);
        addJob(account, "FAILED");
        assertThat(reserve(account, ip, "j2-" + account).ok()).isTrue();

        String other = newAccount();
        addJob(other, "QUEUED");
        assertThat(reserve(other, ip, "j3-" + other).rejection()).isEqualTo(QuotaRejectCode.INFLIGHT);
    }

    @Test
    void inFlightIsCheckedBeforeTheQuotas() {
        String account = newAccount();
        String ip = freshIp();
        for (int i = 0; i < 5; i++) {
            reserve(account, ip, "q-" + account + i);
        }
        addJob(account, "QUEUED");
        assertThat(reserve(account, ip, "q-" + account + "z").rejection()).isEqualTo(QuotaRejectCode.INFLIGHT);
    }

    @Test
    void refundHappensExactlyOnceAndReleaseDeletesTheCharge() {
        String account = newAccount();
        String ip = freshIp();
        reserve(account, ip, "r-" + account);
        assertThat(quota.refund("r-" + account)).isTrue();
        assertThat(quota.refund("r-" + account)).isFalse();
        assertThat(quota.refund("no-such-job")).isFalse();
        assertThat(jdbc.queryForObject("SELECT refunded FROM index_charges WHERE job_id = ?", Integer.class, "r-" + account)).isEqualTo(1);

        reserve(account, ip, "d-" + account);
        quota.release("d-" + account);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM index_charges WHERE job_id = ?", Integer.class, "d-" + account)).isZero();
    }

    @Test
    void chargesAreStoredWithTheDocumentedFormats() {
        String account = newAccount();
        reserve(account, "9.9.9.9", "fmt-" + account);
        var row = jdbc.queryForMap("SELECT * FROM index_charges WHERE job_id = ?", "fmt-" + account);
        assertThat(row.get("utc_day")).isEqualTo("2026-10-03");
        assertThat(row.get("charged_at")).isEqualTo("2026-10-03T12:00:00.000Z");
        assertThat(((Number) row.get("refunded")).intValue()).isZero();
    }

    @Test
    void messagesMatchApiErrorTs() {
        assertThat(QuotaMessages.quotaMessage(QuotaRejectCode.PRECHECK_ACCOUNT_LIMIT))
                .isEqualTo("Too many index checks for your account this hour. Try again later.");
        assertThat(QuotaMessages.quotaMessage(QuotaRejectCode.PRECHECK_IP_LIMIT))
                .isEqualTo("Too many index checks from your network this hour. Try again later.");
        assertThat(QuotaMessages.quotaMessage(QuotaRejectCode.QUOTA_ACCOUNT)).isEqualTo("You have used today's index requests for your account.");
        assertThat(QuotaMessages.quotaMessage(QuotaRejectCode.QUOTA_IP)).isEqualTo("Too many index requests from your network today.");
        assertThat(QuotaMessages.quotaMessage(QuotaRejectCode.INFLIGHT)).isEqualTo("You already have an index running. Wait for it to finish.");
    }

    @Test
    void quotaEndpointNeedsASessionAndCountsNonRefundedCharges() throws Exception {
        Http http = new Http(port, TestEnv.LOCAL_ORIGIN, "X-Forwarded-For");
        Http.Resp anonymous = http.get("/api/quota", freshIp(), null);
        assertThat(anonymous.getStatus()).isEqualTo(401);
        assertThat(anonymous.getContentAsString()).isEqualTo("{\"code\":\"UNAUTHENTICATED\",\"message\":\"Sign in to view quota.\"}");

        String email = freshEmail();
        String ip = freshIp();
        String cookie = cookiePair(http.post("/api/auth/sign-up", credentials(email, "1234567890"), ip, null));
        Http.Resp fresh = http.get("/api/quota", ip, cookie);
        assertThat(fresh.getStatus()).isEqualTo(200);
        assertThat(fresh.getContentAsString()).isEqualTo("{\"remainingAccount\":5,\"remainingIp\":10,\"limitAccount\":5,\"limitIp\":10}");

        String accountId = jdbc.queryForObject("SELECT id FROM accounts WHERE email = ?", String.class, email);
        reserve(accountId, ip, "e1-" + accountId);
        reserve(accountId, ip, "e2-" + accountId);
        assertThat(http.get("/api/quota", ip, cookie).getContentAsString())
                .isEqualTo("{\"remainingAccount\":3,\"remainingIp\":8,\"limitAccount\":5,\"limitIp\":10}");
        quota.refund("e1-" + accountId);
        assertThat(http.get("/api/quota", ip, cookie).getContentAsString())
                .isEqualTo("{\"remainingAccount\":4,\"remainingIp\":9,\"limitAccount\":5,\"limitIp\":10}");
        // Another network address has its own IP count.
        assertThat(http.get("/api/quota", freshIp(), cookie).getContentAsString())
                .isEqualTo("{\"remainingAccount\":4,\"remainingIp\":10,\"limitAccount\":5,\"limitIp\":10}");
    }
}
