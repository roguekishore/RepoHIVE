package com.repohive.model;

/** Either ok, or rejected with a code. */
public record QuotaResult(QuotaRejectCode rejection) {

    public static final QuotaResult OK = new QuotaResult(null);

    public static QuotaResult rejected(QuotaRejectCode code) {
        return new QuotaResult(code);
    }

    public boolean ok() {
        return rejection == null;
    }
}
