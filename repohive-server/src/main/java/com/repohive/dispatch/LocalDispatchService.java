package com.repohive.dispatch;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repohive.model.ExecutionStatus;
import com.repohive.model.JobInput;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Local mode: each run is a child process (the indexer's local-job.js). Its output is appended to
 * {@code <dataDir>/jobs/<jobId>.log}. The processes are destroyed when the server shuts down.
 */
public class LocalDispatchService implements DispatchService {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final List<String> command;
    private final Map<String, String> baseEnvironment;
    private final Path dataDirectory;
    private final Path storeRoot;
    private final String serverUrl;
    private final String internalSecret;
    private final Map<String, Process> processes = new ConcurrentHashMap<>();

    /**
     * @param command the full command line (node plus the script), without arguments of its own
     * @param baseEnvironment the environment the child starts from: the server's own
     * @param storeRoot absolute root of the local store; passed as REPOHIVE_STORE=local:<root>
     */
    public LocalDispatchService(
            List<String> command, Map<String, String> baseEnvironment, Path dataDirectory, Path storeRoot, String serverUrl, String internalSecret) {
        this.command = List.copyOf(command);
        this.baseEnvironment = Map.copyOf(baseEnvironment);
        this.dataDirectory = dataDirectory.toAbsolutePath().normalize();
        this.storeRoot = storeRoot.toAbsolutePath().normalize();
        this.serverUrl = serverUrl;
        this.internalSecret = internalSecret;
    }

    @Override
    public String start(JobInput input, String executionName) {
        String json;
        try {
            json = JSON.writeValueAsString(input);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
        Path log = dataDirectory.resolve("jobs").resolve(input.jobId() + ".log");
        try {
            Files.createDirectories(log.getParent());
            ProcessBuilder builder = new ProcessBuilder(new ArrayList<>(command));
            Map<String, String> env = builder.environment();
            env.clear();
            env.putAll(baseEnvironment);
            env.put("REPOHIVE_JOB_INPUT", json);
            env.put("REPOHIVE_STORE", "local:" + storeRoot);
            env.put("REPOHIVE_SERVER_URL", serverUrl);
            env.put("REPOHIVE_INTERNAL_SECRET", internalSecret);
            env.put("REPOHIVE_TARBALL_DIR", dataDirectory.resolve("tarballs").toString());
            builder.redirectErrorStream(true);
            builder.redirectOutput(ProcessBuilder.Redirect.appendTo(log.toFile()));
            processes.put(executionName, builder.start());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return executionName;
    }

    @Override
    public ExecutionStatus describe(String executionRef) {
        Process process = processes.get(executionRef);
        if (process == null) {
            return ExecutionStatus.UNKNOWN;
        }
        if (process.isAlive()) {
            return ExecutionStatus.RUNNING;
        }
        return process.exitValue() == 0 ? ExecutionStatus.SUCCEEDED : ExecutionStatus.FAILED;
    }

    @PreDestroy
    public void shutdown() {
        for (Process process : processes.values()) {
            process.descendants().forEach(ProcessHandle::destroyForcibly);
            process.destroyForcibly();
        }
        processes.clear();
    }
}
