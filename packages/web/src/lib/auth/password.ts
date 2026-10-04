/**
 * Scrypt with a random 16-byte salt per account,
 * parameters stored alongside the hash, comparison in constant time.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;

export const DEFAULT_SCRYPT = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 64,
  maxmem: 64 * 1024 * 1024,
} as const;

export interface StoredPassword {
  readonly salt: Buffer;
  readonly hash: Buffer;
  readonly scryptN: number;
  readonly scryptR: number;
  readonly scryptP: number;
}

export function hashPassword(password: string): StoredPassword {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, DEFAULT_SCRYPT.keyLength, {
    N: DEFAULT_SCRYPT.N,
    r: DEFAULT_SCRYPT.r,
    p: DEFAULT_SCRYPT.p,
    maxmem: DEFAULT_SCRYPT.maxmem,
  });
  return {
    salt,
    hash,
    scryptN: DEFAULT_SCRYPT.N,
    scryptR: DEFAULT_SCRYPT.r,
    scryptP: DEFAULT_SCRYPT.p,
  };
}

export function verifyPassword(password: string, stored: StoredPassword): boolean {
  const derived = scryptSync(password, stored.salt, stored.hash.length, {
    N: stored.scryptN,
    r: stored.scryptR,
    p: stored.scryptP,
    maxmem: DEFAULT_SCRYPT.maxmem,
  });
  if (derived.length !== stored.hash.length) {
    return false;
  }
  return timingSafeEqual(derived, stored.hash);
}
