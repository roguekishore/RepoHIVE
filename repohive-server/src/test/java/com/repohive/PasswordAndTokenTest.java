package com.repohive;

import static org.assertj.core.api.Assertions.assertThat;

import com.repohive.model.StoredPassword;
import com.repohive.service.PasswordHasher;
import com.repohive.service.SessionTokens;
import java.util.Base64;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;

class PasswordAndTokenTest {

    private final PasswordHasher hasher = new PasswordHasher();

    @Test
    void scryptMatchesNodeCryptoVector() {
        byte[] salt = HexFormat.of().parseHex("000102030405060708090a0b0c0d0e0f");
        byte[] derived = PasswordHasher.derive("password-ten-chars", salt, 16384, 8, 1, 64);
        assertThat(HexFormat.of().formatHex(derived))
                .isEqualTo("822d8e18c56753e7ee89f7c2c2c91c054841127c10a6e325b83e636ec4915d17"
                        + "46c62796ca208696bec7ad9d018b517b08d574d207ae49343dbdc5e735540bf9");
    }

    @Test
    void hashesWithRandomSaltAndVerifiesWithStoredParameters() {
        StoredPassword a = hasher.hash("1234567890");
        StoredPassword b = hasher.hash("1234567890");
        assertThat(a.salt()).hasSize(16).isNotEqualTo(b.salt());
        assertThat(a.hash()).hasSize(64);
        assertThat(a.scryptN()).isEqualTo(16384);
        assertThat(a.scryptR()).isEqualTo(8);
        assertThat(a.scryptP()).isEqualTo(1);
        assertThat(hasher.verify("1234567890", a)).isTrue();
        assertThat(hasher.verify("1234567891", a)).isFalse();
    }

    @Test
    void sessionTokenHashIsLowercaseHexSha256OfUtf8() {
        assertThat(SessionTokens.hash("abc")).isEqualTo("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    @Test
    void sessionTokensAre32RandomBytesInBase64UrlWithoutPadding() {
        String token = SessionTokens.generate();
        assertThat(token).matches("[A-Za-z0-9_-]{43}");
        assertThat(Base64.getUrlDecoder().decode(token)).hasSize(32);
        assertThat(SessionTokens.generate()).isNotEqualTo(token);
    }
}
