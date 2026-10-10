package com.repohive.config;

import com.repohive.dispatch.DispatchService;
import com.repohive.dispatch.LocalDispatchService;
import com.repohive.dispatch.SfnDispatchService;
import com.repohive.service.PrecheckRunner;
import com.repohive.service.ProcessPrecheckRunner;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sfn.SfnClient;

@Configuration(proxyBeanMethods = false)
public class DispatchConfiguration {

    static final String INJECT_FAILURE = "REPOHIVE_LOCAL_JOB_INJECT_FAILURE";

    @Bean
    DispatchService dispatchService(AppConfig config, Environment env) {
        return switch (config.orchestrator()) {
            case OrchestratorConfig.Sfn sfn -> new SfnDispatchService(
                    SfnClient.builder().region(Region.of(config.awsRegion())).build(), sfn.stateMachineArn());
            case OrchestratorConfig.Local local -> {
                Map<String, String> environment = new HashMap<>(System.getenv());
                String inject = env.getProperty(INJECT_FAILURE);
                if (inject != null && !environment.containsKey(INJECT_FAILURE)) {
                    environment.put(INJECT_FAILURE, inject);
                }
                Path store = ((StoreConfig.Local) config.store()).directory();
                yield new LocalDispatchService(
                        List.of(config.node(), config.indexerDir().resolve("dist").resolve("local-job.js").toString()),
                        environment, config.dataDirectory(), store, config.serverUrl(), config.internalSecret());
            }
        };
    }

    @Bean
    PrecheckRunner precheckRunner(AppConfig config) {
        return new ProcessPrecheckRunner(config, Duration.ofSeconds(60), null);
    }
}
