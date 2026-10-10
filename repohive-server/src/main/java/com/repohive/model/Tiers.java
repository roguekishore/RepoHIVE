package com.repohive.model;

import java.util.List;

/** Tier helpers: size order, the shared large slot, and the state machine's per-tier timeouts. */
public final class Tiers {

    public static final List<String> ORDER = List.of("S", "M", "L", "XL");

    private Tiers() {}

    public static boolean isValid(String tier) {
        return ORDER.contains(tier);
    }

    public static boolean isLarge(String tier) {
        return "L".equals(tier) || "XL".equals(tier);
    }

    public static boolean isLarger(String candidate, String current) {
        return ORDER.indexOf(candidate) > ORDER.indexOf(current);
    }

    /** The state machine's timeout for the tier, in seconds (state-machine.asl.json). */
    public static long timeoutSeconds(String tier) {
        return switch (tier) {
            case "L" -> 780;
            case "XL" -> 1080;
            default -> 330;
        };
    }
}
