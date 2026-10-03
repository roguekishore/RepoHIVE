package com.repohive.config;

public sealed interface OrchestratorConfig {

    record Local() implements OrchestratorConfig {}

    record Sfn(String stateMachineArn) implements OrchestratorConfig {}
}
