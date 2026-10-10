package com.repohive.service;

import java.util.Locale;

/** Trim and lowercase before validation and storage; a basic local@domain shape check. */
public final class EmailRules {

    private EmailRules() {}

    public static String normalize(String raw) {
        return raw.strip().toLowerCase(Locale.ROOT);
    }

    public static boolean isValidShape(String email) {
        int at = email.indexOf('@');
        if (at <= 0 || at == email.length() - 1) {
            return false;
        }
        String domain = email.substring(at + 1);
        if (domain.isEmpty() || domain.indexOf('.') == -1) {
            return false;
        }
        return !email.contains(" ") && !email.contains("\t");
    }
}
