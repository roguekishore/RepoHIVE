/**
 * Intake flow for `POST /api/index`.
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  precheck,
  type ArtifactStore,
  type FetchFunction,
  type JobInput,
  type JobLedger,
  type PrecheckResult,
} from "@repohive/indexer";
import { getViewsVersion } from "@repohive/views";
import type { AppDatabase } from "@/server/app-db/database";
import type { AppConfig } from "@/server/hosting/config";
import type { RepoLockReader } from "@/server/hosting/repo-lock";
import type { JobOrchestrator } from "@/server/orchestrator/types";
import {
  recordPrecheckAttempt,
  refundJobCharge,
  releaseReservedCharge,
  reserveAcceptedJobCharge,
} from "@/server/quota/quota";
import { createLocalPrecheckFetch } from "@/server/hosting/local-fixtures";
import { INTAKE_BUSY_RETRY_SECONDS, quotaMessage } from "./api-error";

export type IndexOutcome =
  | { kind: "cached"; repo: string; snapshotId: string; httpStatus: 200 }
  | { kind: "joined"; jobId: string; httpStatus: 200 }
  | { kind: "accepted"; jobId: string; httpStatus: 202 }
  | { kind: "rejected"; code: string; message: string; httpStatus: number }
  | { kind: "busy"; retryAfterSeconds: number; httpStatus: 503 };

export interface ProcessIndexRequestInput {
  readonly accountId: number;
  readonly ip: string;
  readonly repoText: string;
}

export interface ProcessIndexRequestDeps {
  readonly db: AppDatabase;
  readonly config: AppConfig;
  readonly store: ArtifactStore;
  readonly ledger: JobLedger;
  readonly orchestrator: JobOrchestrator;
  readonly repoLocks: RepoLockReader;
  readonly precheckFetch?: FetchFunction;
}

function newJobId(): string {
  return randomBytes(16).toString("hex");
}

function rejectionFromPrecheck(result: Extract<PrecheckResult, { ok: false }>): IndexOutcome {
  return {
    kind: "rejected",
    code: result.reason.toUpperCase().replace(/-/g, "_"),
    message: result.message,
    httpStatus: 422,
  };
}

export async function processIndexRequest(
  input: ProcessIndexRequestInput,
  deps: ProcessIndexRequestDeps,
): Promise<IndexOutcome> {
  const precheckLimit = recordPrecheckAttempt(deps.db, input.accountId, input.ip, deps.config.quota);
  if (!precheckLimit.ok) {
    return {
      kind: "rejected",
      code: precheckLimit.code,
      message: quotaMessage(precheckLimit.code),
      httpStatus: 429,
    };
  }

  const token = deps.config.githubToken ?? "local-stub";
  const precheckFetch =
    deps.precheckFetch ??
    (deps.config.mode === "local"
      ? createLocalPrecheckFetch(path.join(deps.config.dataDirectory, "tarballs"))
      : undefined);
  const precheckResult = await precheck(input.repoText, {
    token,
    store: deps.store,
    viewsVersion: getViewsVersion(),
    ...(precheckFetch === undefined ? {} : { fetch: precheckFetch }),
  });

  if (!precheckResult.ok) {
    return rejectionFromPrecheck(precheckResult);
  }

  if (precheckResult.cacheHit) {
    return {
      kind: "cached",
      repo: precheckResult.repo,
      snapshotId: precheckResult.snapshotId,
      httpStatus: 200,
    };
  }

  const existingJobId = await deps.repoLocks.findInFlightJobId(precheckResult.repo);
  if (existingJobId !== undefined) {
    return { kind: "joined", jobId: existingJobId, httpStatus: 200 };
  }

  const jobId = newJobId();
  const reserve = reserveAcceptedJobCharge(deps.db, {
    accountId: input.accountId,
    ip: input.ip,
    jobId,
    limits: deps.config.quota,
  });
  if (!reserve.ok) {
    return {
      kind: "rejected",
      code: reserve.code,
      message: quotaMessage(reserve.code),
      httpStatus: reserve.code.startsWith("PRECHECK") ? 429 : 429,
    };
  }

  const jobInput: JobInput = {
    jobId,
    accountId: String(input.accountId),
    repo: precheckResult.repo,
    commitSha: precheckResult.commitSha,
    tier: precheckResult.tier,
    snapshotId: precheckResult.snapshotId,
    visibility: "public",
  };

  const claim = await deps.ledger.claim(jobInput);
  if (!claim.claimed) {
    releaseReservedCharge(deps.db, input.accountId, jobId);
    if (claim.reason === "repo-in-flight") {
      return { kind: "joined", jobId: claim.jobId, httpStatus: 200 };
    }
    return { kind: "busy", retryAfterSeconds: INTAKE_BUSY_RETRY_SECONDS, httpStatus: 503 };
  }

  try {
    await deps.orchestrator.start(jobInput);
  } catch {
    await deps.ledger.finish(jobId, {
      state: "failed",
      failureClass: "system",
      failureCode: "ORCHESTRATOR_START_FAILED",
    });
    refundJobCharge(deps.db, jobId, input.accountId);
    return {
      kind: "rejected",
      code: "ORCHESTRATOR_START_FAILED",
      message: "The index could not be started. Your request was not charged.",
      httpStatus: 503,
    };
  }

  return { kind: "accepted", jobId, httpStatus: 202 };
}
