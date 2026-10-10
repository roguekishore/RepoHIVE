package com.repohive.service;

import com.repohive.model.StoredPassword;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.bouncycastle.crypto.generators.SCrypt;
import org.springframework.stereotype.Component;

/** scrypt with a random 16-byte salt per account, parameters stored with the hash, constant-time compare. */
@Component
public class PasswordHasher {

    public static final int PASSWORD_MIN_LENGTH = 10;
    public static final int PASSWORD_MAX_LENGTH = 256;
    public static final int SCRYPT_N = 16384;
    public static final int SCRYPT_R = 8;
    public static final int SCRYPT_P = 1;
    public static final int KEY_LENGTH = 64;

    public static byte[] derive(String password, byte[] salt, int n, int r, int p, int length) {
        return SCrypt.generate(password.getBytes(StandardCharsets.UTF_8), salt, n, r, p, length);
    }

    public StoredPassword hash(String password) {
        byte[] salt = Ids.randomBytes(16);
        return new StoredPassword(salt, derive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, KEY_LENGTH), SCRYPT_N, SCRYPT_R, SCRYPT_P);
    }

    public boolean verify(String password, StoredPassword stored) {
        byte[] derived = derive(password, stored.salt(), stored.scryptN(), stored.scryptR(), stored.scryptP(), stored.hash().length);
        return derived.length == stored.hash().length && MessageDigest.isEqual(derived, stored.hash());
    }
}
