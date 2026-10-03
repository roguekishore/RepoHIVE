package com.repohive.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HexFormat;

/** A 32-byte session token, stored only as the lowercase hex SHA-256 of its UTF-8 text. */
public final class SessionTokens {

    private SessionTokens() {}

    /** 32 random bytes, base64url without padding. */
    public static String generate() {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(Ids.randomBytes(32));
    }

    public static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
