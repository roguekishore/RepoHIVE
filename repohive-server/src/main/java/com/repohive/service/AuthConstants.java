package com.repohive.service;

public final class AuthConstants {

    public static final String SIGN_IN_GENERIC_MESSAGE = "Invalid email or password.";
    public static final String SIGN_IN_LOCKED_MESSAGE = "Too many sign-in attempts. Try again later.";
    public static final String SIGN_UP_IP_LIMIT_MESSAGE = "Too many accounts were created from this network today.";
    public static final int SESSION_DAYS = 30;
    public static final int SIGNIN_MAX_ACCOUNT_FAILURES = 5;
    public static final int SIGNIN_MAX_IP_FAILURES = 20;
    public static final int SIGNIN_LOCKOUT_MINUTES = 15;

    private AuthConstants() {}
}
