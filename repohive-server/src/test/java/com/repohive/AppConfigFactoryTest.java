package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.repohive.config.AppConfig;
import com.repohive.config.AppConfigFactory;
import com.repohive.config.ConfigError;
import com.repohive.config.OrchestratorConfig;
import com.repohive.config.QuotaLimits;
import com.repohive.config.StoreConfig;
import com.repohive.model.Mode;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class AppConfigFactoryTest {

    /** Absolute on every OS: a bare "/srv" has no drive on Windows, and the factory would anchor it to the current drive. */
    private static Path abs(String path) {
        return Path.of(path).toAbsolutePath();
    }

    private static final Path CWD = abs("/srv/app");
    private static final String ARN = "arn:aws:states:ap-south-1:123456789012:stateMachine:repohive-index";

    private static Map<String, String> local() {
        Map<String, String> env = new HashMap<>();
        env.put("REPOHIVE_MODE", "local");
        env.put("REPOHIVE_SITE_ORIGIN", "http://localhost:3000");
        env.put("REPOHIVE_DATA_DIR", "data");
        env.put("REPOHIVE_STORE", "local:store");
        env.put("REPOHIVE_ORCHESTRATOR", "local");
        env.put("REPOHIVE_INTERNAL_SECRET", "local-secret");
        return env;
    }

    private static Map<String, String> hosted() {
        Map<String, String> env = new HashMap<>();
        env.put("REPOHIVE_MODE", "hosted");
        env.put("REPOHIVE_SITE_ORIGIN", "https://repohive.example");
        env.put("REPOHIVE_DATA_DIR", "/var/lib/repohive");
        env.put("REPOHIVE_STORE", "s3:repohive-artifacts");
        env.put("REPOHIVE_ORCHESTRATOR", "sfn:" + ARN);
        env.put("REPOHIVE_GITHUB_TOKEN", "ghp_secretvalue");
        env.put("REPOHIVE_CLIENT_IP_HEADER", "X-RepoHIVE-Client-IP");
        env.put("AWS_REGION", "ap-south-1");
        env.put("REPOHIVE_INTERNAL_SECRET", "hosted-secret");
        return env;
    }

    private static AppConfig parse(Map<String, String> env) {
        return AppConfigFactory.parse(env::get, CWD);
    }

    private static ConfigError failure(Map<String, String> env) {
        assertThatThrownBy(() -> parse(env)).isInstanceOf(ConfigError.class);
        try {
            parse(env);
        } catch (ConfigError e) {
            return e;
        }
        throw new AssertionError();
    }

    private static void expectRejected(Map<String, String> env, String variable) {
        ConfigError error = failure(env);
        assertThat(error.variable()).isEqualTo(variable);
        assertThat(error.getMessage()).startsWith(variable);
    }

    private static Map<String, String> with(Map<String, String> base, String key, String value) {
        Map<String, String> env = new HashMap<>(base);
        env.put(key, value);
        return env;
    }

    @Test
    void localSettingsResolveAgainstTheWorkingDirectoryAndDefaultTheRest() {
        AppConfig config = parse(local());
        assertThat(config.mode()).isEqualTo(Mode.LOCAL);
        assertThat(config.siteOrigin()).isEqualTo("http://localhost:3000");
        assertThat(config.dataDirectory()).isEqualTo(abs("/srv/app/data"));
        assertThat(config.databaseFile()).isEqualTo(abs("/srv/app/data/app.sqlite"));
        assertThat(config.store()).isEqualTo(new StoreConfig.Local(abs("/srv/app/store")));
        assertThat(config.orchestrator()).isEqualTo(new OrchestratorConfig.Local());
        assertThat(config.clientIpHeader()).isNull();
        assertThat(config.githubToken()).isNull();
        assertThat(config.quota()).isEqualTo(new QuotaLimits(5, 10, 20, 40, 5, 3));
        assertThat(config.adminToken()).isNull();
        assertThat(config.adminOrigins()).isEmpty();
        assertThat(config.internalSecret()).isEqualTo("local-secret");
        assertThat(config.indexerDir()).isEqualTo(abs("/srv/packages/indexer"));
        assertThat(config.node()).isEqualTo("node");
        assertThat(config.serverUrl()).isEqualTo("http://127.0.0.1:8080");
        assertThat(config.webDir()).isNull();
    }

    @Test
    void serverUrlFollowsServerPortUnlessSet() {
        Map<String, String> env = with(local(), "server.port", "9090");
        assertThat(parse(env).serverUrl()).isEqualTo("http://127.0.0.1:9090");
        assertThat(parse(with(env, "REPOHIVE_SERVER_URL", "http://x:1")).serverUrl()).isEqualTo("http://x:1");
    }

    @Test
    void optionalSettingsAreRead() {
        Map<String, String> env = local();
        // "/opt/indexer" is not absolute on Windows (no drive), so the factory would resolve it against the working directory.
        Path indexer = abs("/opt/indexer");
        env.put("REPOHIVE_INDEXER_DIR", indexer.toString());
        env.put("REPOHIVE_NODE", "/usr/bin/node24");
        env.put("REPOHIVE_WEB_DIR", "web/out");
        AppConfig config = parse(env);
        assertThat(config.indexerDir()).isEqualTo(indexer);
        assertThat(config.node()).isEqualTo("/usr/bin/node24");
        assertThat(config.webDir()).isEqualTo(abs("/srv/app/web/out"));
    }

    @Test
    void localModeIgnoresTheClientIpHeader() {
        assertThat(parse(with(local(), "REPOHIVE_CLIENT_IP_HEADER", "x-forwarded-for")).clientIpHeader()).isNull();
    }

    @Test
    void localModeRequiresLocalStoreAndOrchestrator() {
        expectRejected(with(with(local(), "REPOHIVE_STORE", "s3:bucket"), "AWS_REGION", "ap-south-1"), "REPOHIVE_STORE");
        expectRejected(with(with(local(), "REPOHIVE_ORCHESTRATOR", "sfn:" + ARN), "AWS_REGION", "x"), "REPOHIVE_ORCHESTRATOR");
    }

    @Test
    void hostedSettingsAreAccepted() {
        AppConfig config = parse(hosted());
        assertThat(config.mode()).isEqualTo(Mode.HOSTED);
        assertThat(config.store()).isEqualTo(new StoreConfig.S3("repohive-artifacts"));
        assertThat(config.orchestrator()).isEqualTo(new OrchestratorConfig.Sfn(ARN));
        assertThat(config.githubToken()).isEqualTo("ghp_secretvalue");
        assertThat(config.clientIpHeader()).isEqualTo("x-repohive-client-ip");
        assertThat(config.awsRegion()).isEqualTo("ap-south-1");
    }

    @Test
    void hostedRequiresHttpsTokenHeaderRegionAndAwsImplementations() {
        expectRejected(with(hosted(), "REPOHIVE_SITE_ORIGIN", "http://repohive.example"), "REPOHIVE_SITE_ORIGIN");
        expectRejected(with(hosted(), "REPOHIVE_GITHUB_TOKEN", null), "REPOHIVE_GITHUB_TOKEN");
        expectRejected(with(hosted(), "REPOHIVE_CLIENT_IP_HEADER", null), "REPOHIVE_CLIENT_IP_HEADER");
        expectRejected(with(hosted(), "REPOHIVE_CLIENT_IP_HEADER", "bad header"), "REPOHIVE_CLIENT_IP_HEADER");
        expectRejected(with(hosted(), "AWS_REGION", " "), "AWS_REGION");
        expectRejected(with(hosted(), "REPOHIVE_ORCHESTRATOR", "local"), "REPOHIVE_ORCHESTRATOR");
    }

    @Test
    void everyRequiredSettingIsRefusedWhenMissingOrBlank() {
        for (String variable : List.of(
                "REPOHIVE_MODE", "REPOHIVE_SITE_ORIGIN", "REPOHIVE_DATA_DIR", "REPOHIVE_STORE", "REPOHIVE_ORCHESTRATOR")) {
            expectRejected(with(local(), variable, null), variable);
            expectRejected(with(local(), variable, "   "), variable);
        }
    }

    @Test
    void malformedValuesAreRefused() {
        expectRejected(with(local(), "REPOHIVE_MODE", "staging"), "REPOHIVE_MODE");
        expectRejected(with(local(), "REPOHIVE_SITE_ORIGIN", "http://localhost:3000/"), "REPOHIVE_SITE_ORIGIN");
        expectRejected(with(local(), "REPOHIVE_SITE_ORIGIN", "http://localhost:3000/app"), "REPOHIVE_SITE_ORIGIN");
        expectRejected(with(local(), "REPOHIVE_SITE_ORIGIN", "ftp://localhost"), "REPOHIVE_SITE_ORIGIN");
        expectRejected(with(local(), "REPOHIVE_SITE_ORIGIN", "localhost:3000"), "REPOHIVE_SITE_ORIGIN");
        expectRejected(with(local(), "REPOHIVE_STORE", "local:"), "REPOHIVE_STORE");
        expectRejected(with(local(), "REPOHIVE_STORE", "/tmp/store"), "REPOHIVE_STORE");
        expectRejected(with(local(), "REPOHIVE_ORCHESTRATOR", "sfn:not-an-arn"), "REPOHIVE_ORCHESTRATOR");
    }

    private static final String ADMIN_TOKEN = "an-admin-token-of-32-characters-xx";

    @Test
    void theAdminApiIsOffUntilATokenIsSetAndTheTokenIsChecked() {
        Map<String, String> env = with(local(), "REPOHIVE_ADMIN_TOKEN", ADMIN_TOKEN);
        assertThat(parse(env).adminToken()).isEqualTo(ADMIN_TOKEN);
        assertThat(parse(env).adminOrigins()).isEmpty();

        expectRejected(with(local(), "REPOHIVE_ADMIN_TOKEN", "too-short"), "REPOHIVE_ADMIN_TOKEN");
        // The worker's secret is in the Lambda and Fargate environments; it must not open the admin API.
        Map<String, String> reused = with(local(), "REPOHIVE_INTERNAL_SECRET", ADMIN_TOKEN);
        reused.put("REPOHIVE_ADMIN_TOKEN", ADMIN_TOKEN);
        expectRejected(reused, "REPOHIVE_ADMIN_TOKEN");

        String shortToken = "short-token-dont-print";
        assertThat(failure(with(local(), "REPOHIVE_ADMIN_TOKEN", shortToken)).getMessage()).doesNotContain(shortToken);
    }

    @Test
    void theAdminTokenCanComeFromSsmInHostedMode() {
        Map<String, String> env = hosted();
        env.put("REPOHIVE_ADMIN_TOKEN_PARAMETER", "/repohive/admin-token");
        AppConfig config = new AppConfigFactory(env::get, CWD, name -> {
            assertThat(name).isEqualTo("/repohive/admin-token");
            return ADMIN_TOKEN;
        }).parse();
        assertThat(config.adminToken()).isEqualTo(ADMIN_TOKEN);

        Map<String, String> localParameter = local();
        localParameter.put("REPOHIVE_ADMIN_TOKEN_PARAMETER", "/x");
        expectRejected(localParameter, "REPOHIVE_ADMIN_TOKEN_PARAMETER");

        assertThatThrownBy(() -> new AppConfigFactory(env::get, CWD, name -> {
                    throw new IllegalStateException("boom");
                }).parse())
                .isInstanceOf(ConfigError.class)
                .hasMessageStartingWith("REPOHIVE_ADMIN_TOKEN_PARAMETER");
        assertThatThrownBy(() -> new AppConfigFactory(env::get, CWD, name -> " ").parse())
                .isInstanceOf(ConfigError.class)
                .hasMessageStartingWith("REPOHIVE_ADMIN_TOKEN_PARAMETER");
    }

    @Test
    void adminOriginsAreExactOriginsAndDefaultToNone() {
        Map<String, String> env = with(local(), "REPOHIVE_ADMIN_ORIGINS", "https://a.example, https://b.example:8443 ,https://a.example");
        assertThat(parse(env).adminOrigins()).containsExactly("https://a.example", "https://b.example:8443");
        for (String bad : List.of("*", "https://a.example/", "https://a.example/path", "a.example", "https://A.example", "https://a.example,")) {
            expectRejected(with(local(), "REPOHIVE_ADMIN_ORIGINS", bad), "REPOHIVE_ADMIN_ORIGINS");
        }
    }

    @Test
    void quotaSettingsMustBePositiveIntegers() {
        Map<String, String> env = local();
        env.put("REPOHIVE_QUOTA_ACCOUNT_DAY", "7");
        env.put("REPOHIVE_QUOTA_IP_DAY", "11");
        env.put("REPOHIVE_QUOTA_PRECHECK_ACCOUNT_HOUR", "21");
        env.put("REPOHIVE_QUOTA_PRECHECK_IP_HOUR", "41");
        env.put("REPOHIVE_GLOBAL_INFLIGHT_CAP", "6");
        env.put("REPOHIVE_SIGNUP_IP_DAY", "4");
        assertThat(parse(env).quota()).isEqualTo(new QuotaLimits(7, 11, 21, 41, 6, 4));
        for (String variable : List.of(
                "REPOHIVE_QUOTA_ACCOUNT_DAY", "REPOHIVE_QUOTA_IP_DAY", "REPOHIVE_QUOTA_PRECHECK_ACCOUNT_HOUR",
                "REPOHIVE_QUOTA_PRECHECK_IP_HOUR", "REPOHIVE_GLOBAL_INFLIGHT_CAP", "REPOHIVE_SIGNUP_IP_DAY")) {
            for (String bad : List.of("0", "-1", "1.5", "abc")) {
                expectRejected(with(local(), variable, bad), variable);
            }
        }
    }

    @Test
    void internalSecretComesFromTheVariableOrFromSsmInHostedMode() {
        expectRejected(with(local(), "REPOHIVE_INTERNAL_SECRET", null), "REPOHIVE_INTERNAL_SECRET");
        expectRejected(with(hosted(), "REPOHIVE_INTERNAL_SECRET", null), "REPOHIVE_INTERNAL_SECRET");

        Map<String, String> viaParameter = with(hosted(), "REPOHIVE_INTERNAL_SECRET", null);
        viaParameter.put("REPOHIVE_INTERNAL_SECRET_PARAMETER", "/repohive/internal-secret");
        AppConfig config = new AppConfigFactory(viaParameter::get, CWD, name -> {
            assertThat(name).isEqualTo("/repohive/internal-secret");
            return "from-ssm";
        }).parse();
        assertThat(config.internalSecret()).isEqualTo("from-ssm");

        Map<String, String> localParameter = with(local(), "REPOHIVE_INTERNAL_SECRET", null);
        localParameter.put("REPOHIVE_INTERNAL_SECRET_PARAMETER", "/x");
        expectRejected(localParameter, "REPOHIVE_INTERNAL_SECRET_PARAMETER");

        Map<String, String> noRegion = with(viaParameter, "AWS_REGION", null);
        noRegion.put("REPOHIVE_STORE", "s3:b");
        expectRejected(noRegion, "AWS_REGION");

        String unreadable = "ssm-secret-name-do-not-print";
        Map<String, String> failing = with(viaParameter, "REPOHIVE_INTERNAL_SECRET_PARAMETER", unreadable);
        assertThatThrownBy(() -> new AppConfigFactory(failing::get, CWD, name -> {
                    throw new IllegalStateException("boom " + name);
                }).parse())
                .isInstanceOf(ConfigError.class)
                .hasMessageStartingWith("REPOHIVE_INTERNAL_SECRET_PARAMETER")
                .hasMessageNotContaining(unreadable);
    }

    @Test
    void errorsNeverEchoAValue() {
        String secret = "ghp_do_not_print_me";
        List<String> messages = List.of(
                failure(with(with(hosted(), "REPOHIVE_GITHUB_TOKEN", secret), "REPOHIVE_CLIENT_IP_HEADER", secret + " x")).getMessage(),
                failure(with(local(), "REPOHIVE_MODE", secret)).getMessage(),
                failure(with(local(), "REPOHIVE_STORE", secret)).getMessage(),
                failure(with(local(), "REPOHIVE_SITE_ORIGIN", secret)).getMessage(),
                failure(with(local(), "REPOHIVE_QUOTA_IP_DAY", secret)).getMessage(),
                failure(with(local(), "REPOHIVE_ORCHESTRATOR", secret)).getMessage());
        for (String message : messages) {
            assertThat(message).doesNotContain(secret);
        }
    }

    @Test
    void toStringLeavesSecretsOut() {
        AppConfig config = parse(hosted());
        assertThat(config.toString()).doesNotContain("ghp_secretvalue").doesNotContain("hosted-secret");
    }
}
