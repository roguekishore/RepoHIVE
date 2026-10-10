package com.repohive.model;

public record StoredPassword(byte[] salt, byte[] hash, int scryptN, int scryptR, int scryptP) {}
