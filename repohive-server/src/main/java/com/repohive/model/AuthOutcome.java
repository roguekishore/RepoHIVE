package com.repohive.model;

public sealed interface AuthOutcome {

    record Granted(SessionGrant grant) implements AuthOutcome {}

    record Rejected(AuthRejectCode code, String message) implements AuthOutcome {}
}
