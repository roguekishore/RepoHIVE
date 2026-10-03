/**
 * hosting-3 Requirements 5 and 6: one test per acceptance criterion called out
 * in the spec execution rules for auth code.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAppDatabase, resetAppDatabaseForTests, type AppDatabase } from "@/server/app-db/database";
import { resetAppConfigForTests } from "@/server/hosting/config";
import { POST as signInPost } from "@/app/api/auth/sign-in/route";
import { POST as signOutPost } from "@/app/api/auth/sign-out/route";
import { POST as signUpPost } from "@/app/api/auth/sign-up/route";
import { resolveSession, signIn, signOut, signUp } from "./accounts";
import {
  SIGNIN_MAX_ACCOUNT_FAILURES,
  SIGNIN_MAX_IP_FAILURES,
  SIGNUP_MAX_PER_IP_PER_DAY,
} from "./constants";
import { getClientIp } from "./client-ip";
import { parseAppConfig } from "@/server/hosting/config";
import { originMatchesSite } from "./origin";
import { hashPassword, verifyPassword } from "./password";
import { hashSessionToken } from "./tokens";
import {
  buildSessionClearCookie,
  buildSessionSetCookie,
  parseSessionCookie,
  sessionCookieName,
} from "./session-cookie";
import { APP_SECURITY_HEADERS } from "./security-headers";

const LOCAL_ENV = {
  REPOHIVE_MODE: "local",
  REPOHIVE_SITE_ORIGIN: "http://localhost:3000",
  REPOHIVE_DATA_DIR: "data",
  REPOHIVE_STORE: "local:store",
  REPOHIVE_LEDGER: "file:ledger.json",
  REPOHIVE_ORCHESTRATOR: "local",
};

const HOSTED_ENV = {
  ...LOCAL_ENV,
  REPOHIVE_MODE: "hosted",
  REPOHIVE_SITE_ORIGIN: "https://repohive.example",
  REPOHIVE_STORE: "s3:artifacts",
  REPOHIVE_LEDGER: "dynamodb:ledger",
  REPOHIVE_ORCHESTRATOR: "sfn:arn:aws:states:ap-south-1:1:stateMachine:x",
  REPOHIVE_GITHUB_TOKEN: "ghp_test",
  REPOHIVE_CLIENT_IP_HEADER: "x-repohive-client-ip",
  AWS_REGION: "ap-south-1",
};

function applyTestEnv(env: Record<string, string>): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("REPOHIVE_") || key === "AWS_REGION") {
      delete process.env[key];
    }
  }
  Object.assign(process.env, env);
  resetAppConfigForTests();
}

function jsonRequest(
  url: string,
  body: unknown,
  init: { origin?: string; cookie?: string; ip?: string } = {},
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.origin !== undefined) {
    headers.Origin = init.origin;
  }
  if (init.cookie !== undefined) {
    headers.Cookie = init.cookie;
  }
  if (init.ip !== undefined) {
    headers["X-Forwarded-For"] = init.ip;
  }
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("Requirement 5.3 password hashing", () => {
  it("round-trips and rejects a wrong password with constant-time compare", () => {
    const stored = hashPassword("correct horse battery");
    expect(verifyPassword("correct horse battery", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
    expect(stored.salt.length).toBe(16);
  });
});

describe("Requirement 5.1 sign-up validation", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = openAppDatabase(":memory:");
  });

  it("trims and lowercases email and enforces password length", () => {
    const ok = signUp(db, "1.2.3.4", "  User@Example.COM ", "1234567890");
    expect(ok.kind).toBe("created");
    const badEmail = signUp(db, "1.2.3.4", "not-an-email", "1234567890");
    expect(badEmail).toMatchObject({ kind: "rejected", code: "INVALID_EMAIL" });
    const short = signUp(db, "1.2.3.4", "a@b.co", "short");
    expect(short).toMatchObject({ kind: "rejected", code: "INVALID_PASSWORD" });
  });

  it("rejects duplicate emails", () => {
    signUp(db, "9.9.9.9", "dup@example.com", "1234567890");
    const again = signUp(db, "9.9.9.9", "dup@example.com", "1234567890");
    expect(again).toMatchObject({ kind: "rejected", code: "EMAIL_TAKEN" });
  });
});

describe("Requirement 5.4 sign-up IP limit", () => {
  it(`allows at most ${SIGNUP_MAX_PER_IP_PER_DAY} accounts per IP per UTC day`, () => {
    const db = openAppDatabase(":memory:");
    const ip = "203.0.113.10";
    for (let index = 0; index < SIGNUP_MAX_PER_IP_PER_DAY; index += 1) {
      const result = signUp(db, ip, `user${index}@example.com`, "1234567890");
      expect(result.kind).toBe("created");
    }
    const blocked = signUp(db, ip, "one-more@example.com", "1234567890");
    expect(blocked).toMatchObject({ kind: "rejected", code: "SIGNUP_IP_LIMIT" });
  });
});

describe("Requirement 5.5 sign-in failures and lockout", () => {
  it("returns one generic message and locks account and IP windows", () => {
    const db = openAppDatabase(":memory:");
    signUp(db, "10.0.0.1", "member@example.com", "1234567890");
    const ip = "198.51.100.4";

    for (let index = 0; index < SIGNIN_MAX_ACCOUNT_FAILURES; index += 1) {
      const fail = signIn(db, ip, "member@example.com", "bad-password");
      expect(fail).toMatchObject({ kind: "rejected", code: "SIGNIN_REJECTED", message: "Invalid email or password." });
    }
    const locked = signIn(db, ip, "member@example.com", "1234567890");
    expect(locked).toMatchObject({ kind: "rejected", code: "SIGNIN_LOCKED" });

    const dbIp = openAppDatabase(":memory:");
    for (let index = 0; index < SIGNUP_MAX_PER_IP_PER_DAY; index += 1) {
      signUp(dbIp, "10.0.0.2", `other${index}@example.com`, "1234567890");
    }
    for (let index = 0; index < SIGNIN_MAX_IP_FAILURES; index += 1) {
      signIn(dbIp, "10.0.0.2", `missing${index}@example.com`, "bad-password");
    }
    const ipLocked = signIn(dbIp, "10.0.0.2", "other0@example.com", "1234567890");
    expect(ipLocked).toMatchObject({ kind: "rejected", code: "SIGNIN_LOCKED" });
  });
});

describe("Requirement 6.1 sessions stored as hashes", () => {
  it("never stores the raw token in SQLite", () => {
    const db = openAppDatabase(":memory:");
    const created = signUp(db, "127.0.0.1", "sess@example.com", "1234567890");
    if (created.kind !== "created") {
      throw new Error("expected created");
    }
    const rows = db.prepare("SELECT token_hash FROM sessions").all() as { token_hash: Uint8Array }[];
    expect(rows).toHaveLength(1);
    const stored = Buffer.from(rows[0]?.token_hash ?? []);
    expect(stored.equals(hashSessionToken(created.sessionToken))).toBe(true);
    expect(stored.equals(Buffer.from(created.sessionToken, "utf8"))).toBe(false);
  });
});

describe("Requirement 6.2 session cookie attributes", () => {
  it("uses __Host- and Secure in hosted mode only", () => {
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    expect(sessionCookieName("hosted")).toBe("__Host-repohive_session");
    expect(sessionCookieName("local")).toBe("repohive_session");
    const hosted = buildSessionSetCookie("tok", expires, "hosted");
    expect(hosted).toContain("__Host-repohive_session=tok");
    expect(hosted).toContain("HttpOnly");
    expect(hosted).toContain("SameSite=Lax");
    expect(hosted).toContain("Secure");
    const local = buildSessionSetCookie("tok", expires, "local");
    expect(local).not.toContain("Secure");
    expect(buildSessionClearCookie("hosted")).toContain("Max-Age=0");
  });
});

describe("Requirement 6.3 Origin header", () => {
  beforeEach(() => applyTestEnv(LOCAL_ENV));
  afterEach(() => resetAppDatabaseForTests());

  it("rejects state-changing auth requests without a matching Origin", async () => {
    resetAppDatabaseForTests(openAppDatabase(":memory:"));
    const bad = await signUpPost(
      jsonRequest("http://localhost/api/auth/sign-up", { email: "a@b.co", password: "1234567890" }),
    );
    expect(bad.status).toBe(403);
    const good = await signUpPost(
      jsonRequest(
        "http://localhost/api/auth/sign-up",
        { email: "a@b.co", password: "1234567890" },
        { origin: "http://localhost:3000", ip: "127.0.0.1" },
      ),
    );
    expect(good.status).toBe(201);
    expect(originMatchesSite(new Request("http://x", { headers: { Origin: "http://localhost:3000" } }), "http://localhost:3000")).toBe(
      true,
    );
  });
});

describe("Requirement 6.4 client IP", () => {
  it("reads the configured header in hosted mode and forwarded chain in local mode", () => {
    const local = parseAppConfig(LOCAL_ENV, "/tmp");
    const hosted = parseAppConfig(HOSTED_ENV, "/tmp");
    const localReq = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "198.51.100.1, 10.0.0.1" },
    });
    expect(getClientIp(localReq, local)).toBe("198.51.100.1");
    const hostedReq = new Request("http://localhost", {
      headers: { "x-repohive-client-ip": "203.0.113.5" },
    });
    expect(getClientIp(hostedReq, hosted)).toBe("203.0.113.5");
  });
});

describe("Requirement 6.5 security headers", () => {
  it("declares nosniff, referrer policy and frame-ancestors none", () => {
    expect(APP_SECURITY_HEADERS).toEqual([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ]);
  });
});

describe("Requirement 5.6 sign-out", () => {
  it("removes the session row on the server", () => {
    const db = openAppDatabase(":memory:");
    const created = signUp(db, "127.0.0.1", "out@example.com", "1234567890");
    if (created.kind !== "created") {
      throw new Error("expected created");
    }
    signOut(db, created.sessionToken);
    expect(resolveSession(db, created.sessionToken)).toBeNull();
  });
});

describe("auth HTTP routes", () => {
  beforeEach(() => {
    applyTestEnv(LOCAL_ENV);
    resetAppDatabaseForTests(openAppDatabase(":memory:"));
  });
  afterEach(() => resetAppDatabaseForTests());

  it("sets and clears the session cookie through sign-in and sign-out", async () => {
    await signUpPost(
      jsonRequest(
        "http://localhost/api/auth/sign-up",
        { email: "route@example.com", password: "1234567890" },
        { origin: "http://localhost:3000", ip: "127.0.0.1" },
      ),
    );
    const signInRes = await signInPost(
      jsonRequest(
        "http://localhost/api/auth/sign-in",
        { email: "route@example.com", password: "1234567890" },
        { origin: "http://localhost:3000", ip: "127.0.0.1" },
      ),
    );
    const setCookie = signInRes.headers.get("Set-Cookie") ?? "";
    const token = parseSessionCookie(
      new Request("http://localhost", { headers: { Cookie: setCookie.split(";")[0] ?? "" } }),
      "local",
    );
    expect(token).toBeTruthy();
    const signOutRes = await signOutPost(
      jsonRequest("http://localhost/api/auth/sign-out", {}, { origin: "http://localhost:3000", cookie: setCookie }),
    );
    expect(signOutRes.status).toBe(200);
    expect(signOutRes.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
