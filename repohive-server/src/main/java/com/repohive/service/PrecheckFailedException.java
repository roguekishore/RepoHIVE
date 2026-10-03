package com.repohive.service;

/** The pre-check command crashed, timed out or printed something unreadable. Carries no secrets. */
public class PrecheckFailedException extends RuntimeException {

    public PrecheckFailedException(String message) {
        super(message);
    }

    public PrecheckFailedException(String message, Throwable cause) {
        super(message, cause);
    }
}
