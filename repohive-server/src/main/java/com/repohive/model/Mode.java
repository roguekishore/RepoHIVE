package com.repohive.model;

public enum Mode {
    HOSTED,
    LOCAL;

    public boolean hosted() {
        return this == HOSTED;
    }
}
