package com.repohive.config;

/** A start-up configuration problem. The message names the variable and never echoes its value. */
public class ConfigError extends RuntimeException {

    private final String variable;

    public ConfigError(String variable, String problem) {
        super(variable + " " + problem);
        this.variable = variable;
    }

    public String variable() {
        return variable;
    }
}
