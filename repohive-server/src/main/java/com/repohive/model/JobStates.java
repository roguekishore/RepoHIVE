package com.repohive.model;

import java.util.List;

/** Job state vocabulary (the indexer's job-states.ts). */
public final class JobStates {

    public static final List<String> ORDER = List.of(
            "queued", "waiting-for-slot", "fetching", "parsing", "grouping", "building-views", "publishing", "succeeded", "failed");

    private JobStates() {}

    public static boolean isTerminal(String state) {
        return "succeeded".equals(state) || "failed".equals(state);
    }

    public static boolean isKnown(String state) {
        return ORDER.contains(state);
    }

    /** Whether a report may move from one state to another; terminal states are reported through complete. */
    public static boolean isForward(String from, String to) {
        if (from.equals(to) || isTerminal(from) || isTerminal(to)) {
            return false;
        }
        return ORDER.indexOf(to) > ORDER.indexOf(from);
    }
}
