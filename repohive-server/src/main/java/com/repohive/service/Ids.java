package com.repohive.service;

import java.security.SecureRandom;
import java.util.HexFormat;

public final class Ids {

    private static final SecureRandom RANDOM = new SecureRandom();

    private Ids() {}

    /** 16 random bytes as 32 lowercase hex characters. */
    public static String randomId() {
        return HexFormat.of().formatHex(randomBytes(16));
    }

    public static byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        RANDOM.nextBytes(bytes);
        return bytes;
    }
}
