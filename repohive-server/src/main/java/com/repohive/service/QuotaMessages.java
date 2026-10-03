package com.repohive.service;

import com.repohive.model.QuotaRejectCode;

public final class QuotaMessages {

    private QuotaMessages() {}

    /** Port of quotaMessage() in intake/api-error.ts. */
    public static String quotaMessage(QuotaRejectCode code) {
        return switch (code) {
            case PRECHECK_ACCOUNT_LIMIT -> "Too many index checks for your account this hour. Try again later.";
            case PRECHECK_IP_LIMIT -> "Too many index checks from your network this hour. Try again later.";
            case QUOTA_ACCOUNT -> "You have used today's index requests for your account.";
            case QUOTA_IP -> "Too many index requests from your network today.";
            case INFLIGHT -> "You already have an index running. Wait for it to finish.";
        };
    }
}
