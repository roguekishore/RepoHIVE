package com.repohive.service;

import com.repohive.model.HealthReport;
import com.repohive.repository.HealthRepository;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.info.BuildProperties;
import org.springframework.stereotype.Service;

/** ok iff the database answers SELECT 1 within 800 ms. */
@Service
public class HealthService {

    static final long CHECK_TIMEOUT_MS = 800;

    private record Sample(String lastCompletedJobAt) {}

    private final HealthRepository repository;
    private final String version;
    private final ExecutorService executor = Executors.newCachedThreadPool(runnable -> {
        Thread thread = new Thread(runnable, "health-check");
        thread.setDaemon(true);
        return thread;
    });

    public HealthService(HealthRepository repository, ObjectProvider<BuildProperties> buildProperties) {
        this.repository = repository;
        BuildProperties build = buildProperties.getIfAvailable();
        this.version = build == null || build.getVersion() == null ? "0.0.0" : build.getVersion();
    }

    public HealthReport check() {
        CompletableFuture<Sample> future = CompletableFuture.supplyAsync(() -> {
            repository.ping();
            return new Sample(repository.lastCompletedJobAt());
        }, executor);
        try {
            Sample sample = future.get(CHECK_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            return new HealthReport("ok", version, true, sample.lastCompletedJobAt());
        } catch (Exception e) {
            // An answer that does not arrive in time counts as unreachable.
            future.cancel(true);
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return new HealthReport("degraded", version, false, null);
        }
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }
}
