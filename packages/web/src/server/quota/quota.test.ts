import { describe, expect, it } from "vitest";
import { openAppDatabase } from "@/server/app-db/database";
import {
  recordPrecheckAttempt,
  refundJobCharge,
  releaseReservedCharge,
  remainingQuota,
  reserveAcceptedJobCharge,
} from "./quota";

const limits = {
  acceptedPerAccountPerDay: 2,
  acceptedPerIpPerDay: 3,
  prechecksPerAccountPerHour: 2,
  prechecksPerIpPerHour: 3,
};

function seedAccount(db: ReturnType<typeof openAppDatabase>, id = 1): void {
  db.prepare(
    `INSERT INTO accounts (
      email, password_salt, password_hash, scrypt_n, scrypt_r, scrypt_p,
      created_at, created_utc_day, created_ip
    ) VALUES ('a@test', x'00', x'00', 16384, 8, 1, '2026-01-01T00:00:00.000Z', '2026-01-01', '9.9.9.9')`,
  ).run();
}

describe("quota", () => {
  it("enforces account daily limits while charges are not refunded", () => {
    const db = openAppDatabase(":memory:");
    seedAccount(db);
    const tight = { ...limits, acceptedPerAccountPerDay: 1 };
    expect(reserveAcceptedJobCharge(db, { accountId: 1, ip: "1.1.1.1", jobId: "j1", limits: tight }).ok).toBe(true);
    db.prepare("DELETE FROM account_inflight WHERE account_id = 1").run();
    const second = reserveAcceptedJobCharge(db, { accountId: 1, ip: "1.1.1.1", jobId: "j2", limits: tight });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe("QUOTA_ACCOUNT");
    }
    expect(remainingQuota(db, 1, "1.1.1.1", tight).accountRemaining).toBe(0);
  });

  it("blocks a second in-flight job for the same account", () => {
    const db = openAppDatabase(":memory:");
    seedAccount(db);
    expect(reserveAcceptedJobCharge(db, { accountId: 1, ip: "1.1.1.1", jobId: "j1", limits }).ok).toBe(true);
    const blocked = reserveAcceptedJobCharge(db, { accountId: 1, ip: "2.2.2.2", jobId: "j2", limits });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("INFLIGHT");
    }
  });

  it("refunds a charge exactly once and clears in-flight", () => {
    const db = openAppDatabase(":memory:");
    seedAccount(db);
    reserveAcceptedJobCharge(db, { accountId: 1, ip: "1.1.1.1", jobId: "j1", limits });
    expect(refundJobCharge(db, "j1", 1)).toBe(true);
    expect(refundJobCharge(db, "j1", 1)).toBe(false);
    expect(remainingQuota(db, 1, "1.1.1.1", limits).accountRemaining).toBe(2);
  });

  it("releases a reserved charge when the ledger claim fails", () => {
    const db = openAppDatabase(":memory:");
    seedAccount(db);
    reserveAcceptedJobCharge(db, { accountId: 1, ip: "1.1.1.1", jobId: "j1", limits });
    releaseReservedCharge(db, 1, "j1");
    expect(remainingQuota(db, 1, "1.1.1.1", limits).accountRemaining).toBe(2);
  });

  it("counts pre-check attempts against hourly limits", () => {
    const db = openAppDatabase(":memory:");
    seedAccount(db);
    expect(recordPrecheckAttempt(db, 1, "1.1.1.1", limits).ok).toBe(true);
    expect(recordPrecheckAttempt(db, 1, "1.1.1.1", limits).ok).toBe(true);
    const blocked = recordPrecheckAttempt(db, 1, "1.1.1.1", limits);
    expect(blocked.ok).toBe(false);
  });
});
