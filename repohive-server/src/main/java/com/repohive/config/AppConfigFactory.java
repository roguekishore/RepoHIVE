package com.repohive.config;

import com.repohive.model.Mode;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Function;
import java.util.regex.Pattern;

/**
 * Reads and validates the configuration (port of hosting/config.ts). Every setting comes from a named variable;
 * a problem raises a {@link ConfigError} naming the variable and never its value. Relative paths resolve against
 * the working directory passed in.
 */
public final class AppConfigFactory {

    /** Every variable read here (plus server.port for the default server URL). */
    public static final List<String> VARIABLES = List.of(
            "REPOHIVE_MODE",
            "REPOHIVE_SITE_ORIGIN",
            "REPOHIVE_DATA_DIR",
            "REPOHIVE_STORE",
            "REPOHIVE_ORCHESTRATOR",
            "REPOHIVE_GITHUB_TOKEN",
            "REPOHIVE_CLIENT_IP_HEADER",
            "AWS_REGION",
            "REPOHIVE_QUOTA_ACCOUNT_DAY",
            "REPOHIVE_QUOTA_IP_DAY",
            "REPOHIVE_QUOTA_PRECHECK_ACCOUNT_HOUR",
            "REPOHIVE_QUOTA_PRECHECK_IP_HOUR",
            "REPOHIVE_GLOBAL_INFLIGHT_CAP",
            "REPOHIVE_SIGNUP_IP_DAY",
            "REPOHIVE_INTERNAL_SECRET",
            "REPOHIVE_INTERNAL_SECRET_PARAMETER",
            "REPOHIVE_ADMIN_TOKEN",
            "REPOHIVE_ADMIN_TOKEN_PARAMETER",
            "REPOHIVE_ADMIN_ORIGINS",
            "REPOHIVE_INDEXER_DIR",
            "REPOHIVE_NODE",
            "REPOHIVE_SERVER_URL",
            "REPOHIVE_WEB_DIR");

    /** An RFC 9110 header field name (a token). */
    private static final Pattern HEADER_NAME = Pattern.compile("^[!#$%&'*+.^_`|~0-9A-Za-z-]+$");

    private final Function<String, String> lookup;
    private final Path cwd;
    private final Function<String, String> parameterReader;

    /** The shortest admin token accepted: it is the only thing between the internet and the limits. */
    static final int ADMIN_TOKEN_MIN_LENGTH = 24;

    /**
     * @param lookup variable name to raw value (null when unset)
     * @param cwd base for relative paths
     * @param parameterReader reads an SSM SecureString by name; only called when
     *     REPOHIVE_INTERNAL_SECRET_PARAMETER or REPOHIVE_ADMIN_TOKEN_PARAMETER is used (hosted)
     */
    public AppConfigFactory(Function<String, String> lookup, Path cwd, Function<String, String> parameterReader) {
        this.lookup = lookup;
        this.cwd = cwd.toAbsolutePath().normalize();
        this.parameterReader = parameterReader;
    }

    public static AppConfig parse(Function<String, String> lookup, Path cwd) {
        return new AppConfigFactory(lookup, cwd, name -> {
            throw new ConfigError("REPOHIVE_INTERNAL_SECRET_PARAMETER", "cannot be read: no SSM reader");
        }).parse();
    }

    private String optional(String name) {
        String value = lookup.apply(name);
        if (value == null) {
            return null;
        }
        value = value.strip();
        return value.isEmpty() ? null : value;
    }

    private String required(String name) {
        String value = optional(name);
        if (value == null) {
            throw new ConfigError(name, "is not set");
        }
        return value;
    }

    private int positiveInt(String name, int fallback) {
        String text = optional(name);
        if (text == null) {
            return fallback;
        }
        try {
            BigDecimal value = new BigDecimal(text);
            if (value.signum() <= 0 || value.stripTrailingZeros().scale() > 0 || value.compareTo(BigDecimal.valueOf(Integer.MAX_VALUE)) > 0) {
                throw new NumberFormatException();
            }
            return value.intValueExact();
        } catch (NumberFormatException | ArithmeticException e) {
            throw new ConfigError(name, "must be a positive integer");
        }
    }

    /** The text after prefix when non-empty, else null. */
    private static String after(String text, String prefix) {
        return text.startsWith(prefix) && text.length() > prefix.length() ? text.substring(prefix.length()) : null;
    }

    private Path resolve(String text) {
        return cwd.resolve(text).normalize();
    }

    /** The origin of text when it is exactly an origin (scheme://host[:port], no path), else null. */
    static String exactOrigin(String text) {
        try {
            URI uri = new URI(text);
            String scheme = uri.getScheme();
            if (scheme == null || (!scheme.equals("http") && !scheme.equals("https"))) {
                return null;
            }
            if (uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) {
                return null;
            }
            int port = uri.getPort();
            boolean defaultPort = (scheme.equals("http") && port == 80) || (scheme.equals("https") && port == 443);
            String rebuilt = scheme + "://" + uri.getHost() + (port == -1 || defaultPort ? "" : ":" + port);
            if (!rebuilt.equals(text) || !text.equals(text.toLowerCase(Locale.ROOT))) {
                return null;
            }
            return rebuilt;
        } catch (URISyntaxException e) {
            return null;
        }
    }

    public AppConfig parse() {
        String modeText = required("REPOHIVE_MODE");
        if (!modeText.equals("hosted") && !modeText.equals("local")) {
            throw new ConfigError("REPOHIVE_MODE", "must be hosted or local");
        }
        Mode mode = modeText.equals("hosted") ? Mode.HOSTED : Mode.LOCAL;
        boolean hosted = mode.hosted();

        String siteOrigin = exactOrigin(required("REPOHIVE_SITE_ORIGIN"));
        if (siteOrigin == null) {
            throw new ConfigError("REPOHIVE_SITE_ORIGIN", "must be an origin such as https://example.com, with no path");
        }
        if (hosted && !siteOrigin.startsWith("https:")) {
            throw new ConfigError("REPOHIVE_SITE_ORIGIN", "must use https in hosted mode");
        }

        Path dataDirectory = resolve(required("REPOHIVE_DATA_DIR"));

        String storeText = required("REPOHIVE_STORE");
        String localDir = after(storeText, "local:");
        String bucket = after(storeText, "s3:");
        StoreConfig store;
        if (localDir != null) {
            store = new StoreConfig.Local(resolve(localDir));
        } else if (bucket != null) {
            store = new StoreConfig.S3(bucket);
        } else {
            throw new ConfigError("REPOHIVE_STORE", "must be local:<dir> or s3:<bucket>");
        }
        if (!hosted && !(store instanceof StoreConfig.Local)) {
            throw new ConfigError("REPOHIVE_STORE", "must be local:<dir> in local mode");
        }

        String orchestratorText = required("REPOHIVE_ORCHESTRATOR");
        String arn = after(orchestratorText, "sfn:");
        OrchestratorConfig orchestrator;
        if (orchestratorText.equals("local")) {
            orchestrator = new OrchestratorConfig.Local();
        } else if (arn != null && arn.startsWith("arn:")) {
            orchestrator = new OrchestratorConfig.Sfn(arn);
        } else {
            throw new ConfigError("REPOHIVE_ORCHESTRATOR", "must be local or sfn:<state machine ARN>");
        }
        if (hosted && !(orchestrator instanceof OrchestratorConfig.Sfn)) {
            throw new ConfigError("REPOHIVE_ORCHESTRATOR", "must be sfn:<state machine ARN> in hosted mode");
        }
        if (!hosted && !(orchestrator instanceof OrchestratorConfig.Local)) {
            throw new ConfigError("REPOHIVE_ORCHESTRATOR", "must be local in local mode");
        }

        String githubToken = optional("REPOHIVE_GITHUB_TOKEN");
        if (hosted && githubToken == null) {
            throw new ConfigError("REPOHIVE_GITHUB_TOKEN", "is not set");
        }

        String clientIpHeader = null;
        if (hosted) {
            String header = required("REPOHIVE_CLIENT_IP_HEADER");
            if (!HEADER_NAME.matcher(header).matches()) {
                throw new ConfigError("REPOHIVE_CLIENT_IP_HEADER", "must be a header name");
            }
            clientIpHeader = header.toLowerCase(Locale.ROOT);
        }

        String awsRegion = optional("AWS_REGION");
        String secretParameter = optional("REPOHIVE_INTERNAL_SECRET_PARAMETER");
        String secret = optional("REPOHIVE_INTERNAL_SECRET");
        boolean usesParameter = secret == null && secretParameter != null;
        if (usesParameter && !hosted) {
            throw new ConfigError("REPOHIVE_INTERNAL_SECRET_PARAMETER", "is only allowed in hosted mode");
        }
        String adminToken = optional("REPOHIVE_ADMIN_TOKEN");
        String adminParameter = optional("REPOHIVE_ADMIN_TOKEN_PARAMETER");
        boolean adminUsesParameter = adminToken == null && adminParameter != null;
        if (adminUsesParameter && !hosted) {
            throw new ConfigError("REPOHIVE_ADMIN_TOKEN_PARAMETER", "is only allowed in hosted mode");
        }
        if (awsRegion == null
                && (store instanceof StoreConfig.S3
                        || orchestrator instanceof OrchestratorConfig.Sfn
                        || usesParameter
                        || adminUsesParameter)) {
            throw new ConfigError("AWS_REGION", "is not set");
        }

        if (secret == null && secretParameter == null) {
            throw new ConfigError(
                    "REPOHIVE_INTERNAL_SECRET",
                    hosted ? "or REPOHIVE_INTERNAL_SECRET_PARAMETER is not set" : "is not set");
        }
        if (usesParameter) {
            secret = readParameter("REPOHIVE_INTERNAL_SECRET_PARAMETER", secretParameter);
        }

        if (adminUsesParameter) {
            adminToken = readParameter("REPOHIVE_ADMIN_TOKEN_PARAMETER", adminParameter);
        }
        String adminVariable = adminUsesParameter ? "REPOHIVE_ADMIN_TOKEN_PARAMETER" : "REPOHIVE_ADMIN_TOKEN";
        if (adminToken != null && adminToken.length() < ADMIN_TOKEN_MIN_LENGTH) {
            throw new ConfigError(adminVariable, "must be at least " + ADMIN_TOKEN_MIN_LENGTH + " characters");
        }
        if (adminToken != null && adminToken.equals(secret)) {
            // The worker's secret sits in the Lambda and Fargate environments; the admin token must not.
            throw new ConfigError(adminVariable, "must differ from the internal secret");
        }
        List<String> adminOrigins = adminOrigins();

        QuotaLimits d = QuotaLimits.DEFAULTS;
        QuotaLimits quota = new QuotaLimits(
                positiveInt("REPOHIVE_QUOTA_ACCOUNT_DAY", d.acceptedPerAccountPerDay()),
                positiveInt("REPOHIVE_QUOTA_IP_DAY", d.acceptedPerIpPerDay()),
                positiveInt("REPOHIVE_QUOTA_PRECHECK_ACCOUNT_HOUR", d.prechecksPerAccountPerHour()),
                positiveInt("REPOHIVE_QUOTA_PRECHECK_IP_HOUR", d.prechecksPerIpPerHour()),
                positiveInt("REPOHIVE_GLOBAL_INFLIGHT_CAP", d.inFlightCap()),
                positiveInt("REPOHIVE_SIGNUP_IP_DAY", d.signUpsPerIpPerDay()));

        String indexer = optional("REPOHIVE_INDEXER_DIR");
        Path indexerDir = resolve(indexer == null ? "../packages/indexer" : indexer);
        String node = optional("REPOHIVE_NODE");
        String serverUrl = optional("REPOHIVE_SERVER_URL");
        if (serverUrl == null) {
            String port = optional("server.port");
            serverUrl = "http://127.0.0.1:" + (port == null ? "8080" : port);
        }
        String webDir = optional("REPOHIVE_WEB_DIR");

        return new AppConfig(
                mode,
                siteOrigin,
                dataDirectory,
                store,
                orchestrator,
                githubToken,
                clientIpHeader,
                awsRegion,
                quota,
                secret,
                indexerDir,
                node == null ? "node" : node,
                serverUrl,
                webDir == null ? null : resolve(webDir),
                adminToken,
                adminOrigins);
    }

    /** An SSM SecureString read at start-up; the error names the variable, never the value. */
    private String readParameter(String variable, String parameterName) {
        String value;
        try {
            value = parameterReader.apply(parameterName);
        } catch (ConfigError e) {
            throw e;
        } catch (RuntimeException e) {
            throw new ConfigError(variable, "could not be read from SSM");
        }
        if (value == null || value.isBlank()) {
            throw new ConfigError(variable, "is empty in SSM");
        }
        return value;
    }

    /** Comma-separated exact origins; unset means none. */
    private List<String> adminOrigins() {
        String text = optional("REPOHIVE_ADMIN_ORIGINS");
        if (text == null) {
            return List.of();
        }
        List<String> origins = new ArrayList<>();
        for (String part : text.split(",", -1)) {
            String origin = exactOrigin(part.strip());
            if (origin == null) {
                throw new ConfigError("REPOHIVE_ADMIN_ORIGINS", "must be a comma-separated list of origins such as https://example.com");
            }
            if (!origins.contains(origin)) {
                origins.add(origin);
            }
        }
        return List.copyOf(origins);
    }
}
