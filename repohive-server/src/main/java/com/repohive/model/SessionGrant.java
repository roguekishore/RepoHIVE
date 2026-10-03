package com.repohive.model;

import java.time.Instant;

public record SessionGrant(String accountId, String sessionToken, Instant expiresAt) {}
