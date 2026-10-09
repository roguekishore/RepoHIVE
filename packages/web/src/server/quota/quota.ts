/**
 * Fixed quota, pre-check rate limits, charges and refunds.
 */
import type { AppDatabase } from "@/server/app-db/database";
import type { QuotaLimits } from "@/server/hosting/config";
import { nowIso, utcCalendarDay, utcHourBucket } from "@/server/auth/time";

export type QuotaRejectCode = "PRECHECK_ACCOUNT_LIMIT" | "PRECHECK_IP_LIMIT" | "QUOTA_ACCOUNT" | "QUOTA_IP" | "INFLIGHT";

export interface RemainingQuota {
  readonly accountRemaining: number;
  readonly ipRemaining: number;
  readonly accountLimit: number;
  readonly ipLimit: number;
}

function bucketKey(kind: "account" | "ip", id: string | number, hour: string): string {
  return `${kind}:${id}:${hour}`;
}

function incrementPrecheckBucket(db: AppDatabase, bucket: string, limit: number): boolean {
  const row = db.prepare("SELECT count FROM precheck_hourly WHERE bucket = ?").get(bucket) as
    | { count: number }
    | undefined;
  const count = row?.count ?? 0;
  if (count >= limit) {
    return false;
  }
  if (row === undefined) {
    db.prepare("INSERT INTO precheck_hourly (bucket, count) VALUES (?, 1)").run(bucket);
  } else {
    db.prepare("UPDATE precheck_hourly SET count = count + 1 WHERE bucket = ?").run(bucket);
  }
  return true;
}

/** Records one pre-check attempt against hourly account and IP limits. */
export function recordPrecheckAttempt(
  db: AppDatabase,
  accountId: number,
  ip: string,
  limits: QuotaLimits,
): { ok: true } | { ok: false; code: QuotaRejectCode } {
  const hour = utcHourBucket();
  const accountBucket = bucketKey("account", accountId, hour);
  const ipBucket = bucketKey("ip", ip, hour);
  let ok = false;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!incrementPrecheckBucket(db, accountBucket, limits.prechecksPerAccountPerHour)) {
      db.exec("ROLLBACK");
      return { ok: false, code: "PRECHECK_ACCOUNT_LIMIT" };
    }
    if (!incrementPrecheckBucket(db, ipBucket, limits.prechecksPerIpPerHour)) {
      db.exec("ROLLBACK");
      return { ok: false, code: "PRECHECK_IP_LIMIT" };
    }
    db.exec("COMMIT");
    ok = true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return ok ? { ok: true } : { ok: false, code: "PRECHECK_IP_LIMIT" };
}

function countCharges(db: AppDatabase, column: "account_id" | "ip", value: string | number, day: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM index_charges
       WHERE ${column} = ? AND utc_day = ? AND refunded = 0`,
    )
    .get(value, day) as { count: number };
  return row.count;
}

export function remainingQuota(db: AppDatabase, accountId: number, ip: string, limits: QuotaLimits): RemainingQuota {
  const day = utcCalendarDay();
  const accountUsed = countCharges(db, "account_id", accountId, day);
  const ipUsed = countCharges(db, "ip", ip, day);
  return {
    accountRemaining: Math.max(0, limits.acceptedPerAccountPerDay - accountUsed),
    ipRemaining: Math.max(0, limits.acceptedPerIpPerDay - ipUsed),
    accountLimit: limits.acceptedPerAccountPerDay,
    ipLimit: limits.acceptedPerIpPerDay,
  };
}

function hasAccountInflight(db: AppDatabase, accountId: number): boolean {
  const row = db.prepare("SELECT 1 FROM account_inflight WHERE account_id = ?").get(accountId);
  return row !== undefined;
}

export interface ReserveChargeInput {
  readonly accountId: number;
  readonly ip: string;
  readonly jobId: string;
  readonly limits: QuotaLimits;
}

/** Quota and in-flight check, then insert charge and account in-flight. */
export function reserveAcceptedJobCharge(
  db: AppDatabase,
  input: ReserveChargeInput,
): { ok: true } | { ok: false; code: QuotaRejectCode } {
  const day = utcCalendarDay();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (hasAccountInflight(db, input.accountId)) {
      db.exec("ROLLBACK");
      return { ok: false, code: "INFLIGHT" };
    }
    if (countCharges(db, "account_id", input.accountId, day) >= input.limits.acceptedPerAccountPerDay) {
      db.exec("ROLLBACK");
      return { ok: false, code: "QUOTA_ACCOUNT" };
    }
    if (countCharges(db, "ip", input.ip, day) >= input.limits.acceptedPerIpPerDay) {
      db.exec("ROLLBACK");
      return { ok: false, code: "QUOTA_IP" };
    }
    db.prepare(
      "INSERT INTO index_charges (account_id, ip, utc_day, job_id, charged_at, refunded) VALUES (?, ?, ?, ?, ?, 0)",
    ).run(input.accountId, input.ip, day, input.jobId, nowIso());
    db.prepare("INSERT INTO account_inflight (account_id, job_id) VALUES (?, ?)").run(input.accountId, input.jobId);
    db.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Undoes {@link reserveAcceptedJobCharge} when the ledger claim fails. */
export function releaseReservedCharge(db: AppDatabase, accountId: number, jobId: string): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM index_charges WHERE job_id = ?").run(jobId);
    db.prepare("DELETE FROM account_inflight WHERE account_id = ? AND job_id = ?").run(accountId, jobId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Refund a system failure exactly once. */
/** Clears the one in-flight slot after any terminal job. */
export function clearAccountInflight(db: AppDatabase, accountId: number, jobId: string): void {
  db.prepare("DELETE FROM account_inflight WHERE account_id = ? AND job_id = ?").run(accountId, jobId);
}

export function refundJobCharge(db: AppDatabase, jobId: string, accountId: number): boolean {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare("SELECT refunded FROM index_charges WHERE job_id = ?")
      .get(jobId) as { refunded: number } | undefined;
    if (row === undefined || row.refunded !== 0) {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare("UPDATE index_charges SET refunded = 1 WHERE job_id = ?").run(jobId);
    db.prepare("DELETE FROM account_inflight WHERE account_id = ? AND job_id = ?").run(accountId, jobId);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
