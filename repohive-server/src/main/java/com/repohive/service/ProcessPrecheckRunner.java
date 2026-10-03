package com.repohive.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.config.AppConfig;
import com.repohive.model.PrecheckResult;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Runs {@code node <indexer>/dist/precheck-cli.js --repo <text>} as a child process (no shell: the text is its own
 * argument). The GitHub token travels in the child's environment only and is scrubbed from anything logged.
 */
public class ProcessPrecheckRunner implements PrecheckRunner {

    private static final Logger LOG = LoggerFactory.getLogger(ProcessPrecheckRunner.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final List<String> command;
    private final Duration timeout;
    private final String githubToken;
    private final Path localFixtures;

    /** @param commandPrefix the command before the arguments; null for node plus precheck-cli.js */
    public ProcessPrecheckRunner(AppConfig config, Duration timeout, List<String> commandPrefix) {
        this.command = commandPrefix != null
                ? List.copyOf(commandPrefix)
                : List.of(config.node(), config.indexerDir().resolve("dist").resolve("precheck-cli.js").toString());
        this.timeout = timeout;
        this.githubToken = config.githubToken();
        this.localFixtures = config.hosted() ? null : config.dataDirectory().resolve("tarballs").toAbsolutePath();
    }

    @Override
    public PrecheckResult run(String repoText) {
        List<String> args = new ArrayList<>(command);
        args.add("--repo");
        args.add(repoText);
        if (localFixtures != null) {
            args.add("--local-fixtures");
            args.add(localFixtures.toString());
        }
        Path out = null;
        Path err = null;
        try {
            out = Files.createTempFile("repohive-precheck-out-", ".txt");
            err = Files.createTempFile("repohive-precheck-err-", ".txt");
            ProcessBuilder builder = new ProcessBuilder(args);
            if (githubToken != null) {
                builder.environment().put("REPOHIVE_GITHUB_TOKEN", githubToken);
            }
            builder.redirectOutput(out.toFile());
            builder.redirectError(err.toFile());
            Process process = builder.start();
            process.getOutputStream().close();
            try {
                if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                    process.descendants().forEach(ProcessHandle::destroyForcibly);
                    process.destroyForcibly();
                    throw new PrecheckFailedException("pre-check timed out");
                }
            } catch (InterruptedException e) {
                process.destroyForcibly();
                Thread.currentThread().interrupt();
                throw new PrecheckFailedException("pre-check interrupted", e);
            }
            String stdout = Files.readString(out, StandardCharsets.UTF_8);
            if (process.exitValue() != 0) {
                LOG.error("pre-check exited with {}: {}", process.exitValue(), scrub(Files.readString(err, StandardCharsets.UTF_8)));
                throw new PrecheckFailedException("pre-check exited with " + process.exitValue());
            }
            return parse(stdout);
        } catch (IOException e) {
            throw new PrecheckFailedException("pre-check could not run", e);
        } finally {
            delete(out);
            delete(err);
        }
    }

    private String scrub(String text) {
        String cleaned = githubToken == null ? text : text.replace(githubToken, "***");
        return cleaned.length() > 2000 ? cleaned.substring(0, 2000) : cleaned;
    }

    private static void delete(Path path) {
        if (path != null) {
            try {
                Files.deleteIfExists(path);
            } catch (IOException ignored) {
                // best effort
            }
        }
    }

    /** The single JSON line the CLI prints. */
    static PrecheckResult parse(String stdout) {
        String line = stdout.strip();
        if (line.isEmpty() || line.indexOf('\n') >= 0) {
            throw new PrecheckFailedException("pre-check printed no single result line");
        }
        try {
            JsonNode node = JSON.readTree(line);
            if (node == null || !node.isObject() || !node.path("ok").isBoolean()) {
                throw new PrecheckFailedException("pre-check result is malformed");
            }
            if (!node.get("ok").asBoolean()) {
                if (!node.path("reason").isTextual() || !node.path("message").isTextual()) {
                    throw new PrecheckFailedException("pre-check rejection is malformed");
                }
                return new PrecheckResult.Rejected(node.get("reason").asText(), node.get("message").asText());
            }
            for (String field : List.of("repo", "commitSha", "tier", "snapshotId")) {
                if (!node.path(field).isTextual() || node.get(field).asText().isEmpty()) {
                    throw new PrecheckFailedException("pre-check result lacks " + field);
                }
            }
            if (!com.repohive.model.Tiers.isValid(node.get("tier").asText())) {
                throw new PrecheckFailedException("pre-check result has an unknown tier");
            }
            return new PrecheckResult.Accepted(
                    node.get("repo").asText(), node.get("commitSha").asText(), node.get("tier").asText(),
                    node.get("snapshotId").asText(), node.path("javaFiles").asLong(0), node.path("javaBytes").asLong(0),
                    node.path("truncated").asBoolean(false));
        } catch (IOException e) {
            throw new PrecheckFailedException("pre-check output is not JSON", e);
        }
    }
}
