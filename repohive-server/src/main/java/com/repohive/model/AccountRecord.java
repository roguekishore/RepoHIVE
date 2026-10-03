package com.repohive.model;

/** One accounts row. Salt and hash are lowercase hex. */
public record AccountRecord(
        String id,
        String email,
        String passwordSalt,
        String passwordHash,
        int scryptN,
        int scryptR,
        int scryptP,
        String createdAt,
        String createdUtcDay,
        String createdIp) {}
