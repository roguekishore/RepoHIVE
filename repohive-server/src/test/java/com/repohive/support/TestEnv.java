package com.repohive.support;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.test.context.DynamicPropertyRegistry;

/** Explicit settings for Spring tests: nothing depends on config/local.env. */
public final class TestEnv {

    public static final String LOCAL_ORIGIN = "http://localhost:3000";
    public static final String HOSTED_ORIGIN = "https://repohive.example";

    private TestEnv() {}

    public static Path tempDir() {
        try {
            Path dir = Files.createTempDirectory("repohive-server-test-");
            Runtime.getRuntime().addShutdownHook(new Thread(() -> deleteQuietly(dir)));
            return dir;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static void deleteQuietly(Path dir) {
        try (var walk = Files.walk(dir)) {
            walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
        } catch (IOException ignored) {
            // best effort
        }
    }

    public static void local(DynamicPropertyRegistry registry, Path dir) {
        registry.add("REPOHIVE_MODE", () -> "local");
        registry.add("REPOHIVE_SITE_ORIGIN", () -> LOCAL_ORIGIN);
        registry.add("REPOHIVE_DATA_DIR", () -> dir.resolve("data").toString());
        registry.add("REPOHIVE_STORE", () -> "local:" + dir.resolve("store"));
        registry.add("REPOHIVE_ORCHESTRATOR", () -> "local");
        registry.add("REPOHIVE_INTERNAL_SECRET", () -> "test-internal-secret");
        quiet(registry);
    }

    public static final String ADMIN_TOKEN = "test-admin-token-with-32-characters!";
    public static final String ADMIN_ORIGIN = "https://hivequota.example";

    /** Switches the admin API on, callable cross-origin from {@link #ADMIN_ORIGIN} only. */
    public static void admin(DynamicPropertyRegistry registry) {
        registry.add("REPOHIVE_ADMIN_TOKEN", () -> ADMIN_TOKEN);
        registry.add("REPOHIVE_ADMIN_ORIGINS", () -> ADMIN_ORIGIN);
    }

    /** Nothing runs on a timer in tests: they call the services themselves. */
    private static void quiet(DynamicPropertyRegistry registry) {
        registry.add("repohive.backup.enabled", () -> "false");
        for (String name : new String[] {"slot", "reconcile"}) {
            registry.add("repohive." + name + ".interval-ms", () -> "86400000");
            registry.add("repohive." + name + ".initial-delay-ms", () -> "86400000");
        }
    }

    public static void hosted(DynamicPropertyRegistry registry, Path dir) {
        registry.add("REPOHIVE_MODE", () -> "hosted");
        registry.add("REPOHIVE_SITE_ORIGIN", () -> HOSTED_ORIGIN);
        registry.add("REPOHIVE_DATA_DIR", () -> dir.resolve("data").toString());
        registry.add("REPOHIVE_STORE", () -> "s3:test-bucket");
        registry.add("REPOHIVE_ORCHESTRATOR", () -> "sfn:arn:aws:states:ap-south-1:123456789012:stateMachine:x");
        registry.add("REPOHIVE_GITHUB_TOKEN", () -> "test-token");
        registry.add("REPOHIVE_CLIENT_IP_HEADER", () -> "X-RepoHIVE-Client-IP");
        registry.add("AWS_REGION", () -> "ap-south-1");
        registry.add("REPOHIVE_INTERNAL_SECRET", () -> "test-internal-secret");
        quiet(registry);
    }
}
