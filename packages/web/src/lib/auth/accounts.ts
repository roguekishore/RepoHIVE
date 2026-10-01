/**
 * hosting-3 Requirements 5 and 6: account creation, sign-in with lockouts,
 * sessions and sign-out.
 */
import type { AppDatabase } from "@/lib/app-db/database";
import {
  SIGN_IN_GENERIC_MESSAGE,
  SIGN_IN_LOCKED_MESSAGE,
  SIGN_UP_IP_LIMIT_MESSAGE,
  SESSION_DAYS,
  SIGNIN_LOCKOUT_MINUTES,
  SIGNIN_MAX_ACCOUNT_FAILURES,
  SIGNIN_MAX_IP_FAILURES,
  SIGNUP_MAX_PER_IP_PER_DAY,
} from "./constants";
import { isValidEmailShape, normalizeEmail } from "./email";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyPassword } from "./password";
import { addDaysIso, isoSinceMinutes, nowIso, utcCalendarDay } from "./time";
import { generateSessionToken, hashSessionToken } from "./tokens";

export type AuthRejectCode =
  | "INVALID_EMAIL"
  | "INVALID_PASSWORD"
  | "EMAIL_TAKEN"
  | "SIGNUP_IP_LIMIT"
  | "SIGNIN_REJECTED"
  | "SIGNIN_LOCKED"
  | "ORIGIN"
  | "BAD_JSON";

export type SignUpResult =
  | { kind: "created"; accountId: number; sessionToken: string; expiresAt: string }
  | { kind: "rejected"; code: AuthRejectCode; message: string };

export type SignInResult =
  | { kind: "signed_in"; accountId: number; sessionToken: string; expiresAt: string }
  | { kind: "rejected"; code: AuthRejectCode; message: string };

export type SignOutResult = { kind: "signed_out" } | { kind: "rejected"; code: AuthRejectCode; message: string };

interface AccountRow {
  id: number;
  email: string;
  password_salt: Buffer;
  password_hash: Buffer;
  scrypt_n: number;
  scrypt_r: number;
  scrypt_p: number;
}

function readStoredPassword(row: AccountRow) {
  return {
    salt: row.password_salt,
    hash: row.password_hash,
    scryptN: row.scrypt_n,
    scryptR: row.scrypt_r,
    scryptP: row.scrypt_p,
  };
}

function countSignupFromIp(db: AppDatabase, ip: string, utcDay: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM accounts WHERE created_ip = ? AND created_utc_day = ?")
    .get(ip, utcDay) as { count: number };
  return row.count;
}

function isSignInLocked(db: AppDatabase, accountId: number | undefined, ip: string): boolean {
  const since = isoSinceMinutes(SIGNIN_LOCKOUT_MINUTES);
  if (accountId !== undefined) {
    const accountRow = db
      .prepare(
        "SELECT COUNT(*) AS count FROM sign_in_failures WHERE account_id = ? AND failed_at >= ?",
      )
      .get(accountId, since) as { count: number };
    if (accountRow.count >= SIGNIN_MAX_ACCOUNT_FAILURES) {
      return true;
    }
  }
  const ipRow = db
    .prepare("SELECT COUNT(*) AS count FROM sign_in_failures WHERE ip = ? AND failed_at >= ?")
    .get(ip, since) as { count: number };
  return ipRow.count >= SIGNIN_MAX_IP_FAILURES;
}

function recordSignInFailure(db: AppDatabase, accountId: number | undefined, ip: string): void {
  db.prepare("INSERT INTO sign_in_failures (account_id, ip, failed_at) VALUES (?, ?, ?)").run(
    accountId ?? null,
    ip,
    nowIso(),
  );
}

function createSession(db: AppDatabase, accountId: number): { sessionToken: string; expiresAt: string } {
  const sessionToken = generateSessionToken();
  const tokenHash = hashSessionToken(sessionToken);
  const createdAt = nowIso();
  const expiresAt = addDaysIso(new Date(createdAt), SESSION_DAYS);
  db.prepare(
    "INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(tokenHash, accountId, expiresAt, createdAt);
  return { sessionToken, expiresAt };
}

export function signUp(db: AppDatabase, ip: string, rawEmail: string, password: string): SignUpResult {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmailShape(email)) {
    return { kind: "rejected", code: "INVALID_EMAIL", message: "Enter a valid email address." };
  }
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return {
      kind: "rejected",
      code: "INVALID_PASSWORD",
      message: `Password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`,
    };
  }

  const day = utcCalendarDay();
  if (countSignupFromIp(db, ip, day) >= SIGNUP_MAX_PER_IP_PER_DAY) {
    return { kind: "rejected", code: "SIGNUP_IP_LIMIT", message: SIGN_UP_IP_LIMIT_MESSAGE };
  }

  const stored = hashPassword(password);
  const createdAt = nowIso();
  try {
    const info = db
      .prepare(
        `INSERT INTO accounts (
          email, password_salt, password_hash, scrypt_n, scrypt_r, scrypt_p,
          created_at, created_utc_day, created_ip
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        email,
        stored.salt,
        stored.hash,
        stored.scryptN,
        stored.scryptR,
        stored.scryptP,
        createdAt,
        day,
        ip,
      );
    const accountId = Number(info.lastInsertRowid);
    const session = createSession(db, accountId);
    return { kind: "created", accountId, ...session };
  } catch (error) {
    const errcode =
      typeof error === "object" && error !== null && "errcode" in error ? Number(error.errcode) : undefined;
    if (errcode === 2067 || (error instanceof Error && error.message.includes("UNIQUE"))) {
      return { kind: "rejected", code: "EMAIL_TAKEN", message: "An account with this email already exists." };
    }
    throw error;
  }
}

export function signIn(
  db: AppDatabase,
  ip: string,
  rawEmail: string,
  password: string,
): SignInResult {
  const email = normalizeEmail(rawEmail);
  const row = db.prepare("SELECT * FROM accounts WHERE email = ?").get(email) as AccountRow | undefined;

  if (isSignInLocked(db, row?.id, ip)) {
    return { kind: "rejected", code: "SIGNIN_LOCKED", message: SIGN_IN_LOCKED_MESSAGE };
  }

  if (row === undefined || !verifyPassword(password, readStoredPassword(row))) {
    recordSignInFailure(db, row?.id, ip);
    return { kind: "rejected", code: "SIGNIN_REJECTED", message: SIGN_IN_GENERIC_MESSAGE };
  }

  const session = createSession(db, row.id);
  return { kind: "signed_in", accountId: row.id, ...session };
}

export function signOut(db: AppDatabase, sessionToken: string | undefined): SignOutResult {
  if (sessionToken === undefined) {
    return { kind: "signed_out" };
  }
  const tokenHash = hashSessionToken(sessionToken);
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  return { kind: "signed_out" };
}

export interface ActiveSession {
  accountId: number;
  email: string;
}

/** Returns the signed-in account when the cookie token is valid and unexpired. */
export function resolveSession(db: AppDatabase, sessionToken: string | undefined): ActiveSession | null {
  if (sessionToken === undefined) {
    return null;
  }
  const tokenHash = hashSessionToken(sessionToken);
  const row = db
    .prepare(
      `SELECT s.account_id AS accountId, a.email AS email, s.expires_at AS expiresAt
       FROM sessions s
       INNER JOIN accounts a ON a.id = s.account_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as { accountId: number; email: string; expiresAt: string } | undefined;
  if (row === undefined) {
    return null;
  }
  if (row.expiresAt <= nowIso()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  return { accountId: row.accountId, email: row.email };
}
