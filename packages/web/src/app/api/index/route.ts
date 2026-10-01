import { resolveSession } from "@/lib/auth/accounts";
import { authContext, guardStateChanging, jsonResponse, readJsonBody } from "@/lib/auth/http";
import { getArtifactStore, getJobLedger } from "@/lib/hosting/clients";
import { createRepoLockReader } from "@/lib/hosting/repo-lock";
import { processIndexRequest } from "@/lib/intake/process-index-request";
import { INTAKE_BUSY_RETRY_SECONDS } from "@/lib/intake/api-error";
import { getJobOrchestrator } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originBlock = guardStateChanging(request);
  if (originBlock !== undefined) {
    return originBlock;
  }

  const body = (await readJsonBody(request)) as { repo?: unknown } | undefined;
  if (body === undefined || typeof body.repo !== "string" || body.repo.trim() === "") {
    return jsonResponse({ code: "BAD_REQUEST", message: "Expected a repository reference." }, { status: 400 });
  }

  const { config, db, ip, sessionToken } = authContext(request);
  const session = resolveSession(db, sessionToken);
  if (session === null) {
    return jsonResponse({ code: "UNAUTHENTICATED", message: "Sign in to request an index." }, { status: 401 });
  }

  const outcome = await processIndexRequest(
    { accountId: session.accountId, ip, repoText: body.repo.trim() },
    {
      db,
      config,
      store: getArtifactStore(config),
      ledger: getJobLedger(config),
      orchestrator: getJobOrchestrator(config),
      repoLocks: createRepoLockReader(config),
    },
  );

  const headers = new Headers();
  if (outcome.kind === "busy") {
    headers.set("Retry-After", String(outcome.retryAfterSeconds ?? INTAKE_BUSY_RETRY_SECONDS));
  }

  switch (outcome.kind) {
    case "cached":
      return jsonResponse({ status: "cached", repo: outcome.repo, snapshotId: outcome.snapshotId }, { status: outcome.httpStatus, headers });
    case "joined":
      return jsonResponse({ status: "joined", jobId: outcome.jobId }, { status: outcome.httpStatus, headers });
    case "accepted":
      return jsonResponse({ status: "accepted", jobId: outcome.jobId }, { status: outcome.httpStatus, headers });
    case "busy":
      return jsonResponse({ status: "busy", retryAfterSeconds: outcome.retryAfterSeconds }, { status: outcome.httpStatus, headers });
    case "rejected":
      return jsonResponse({ status: "rejected", code: outcome.code, message: outcome.message }, { status: outcome.httpStatus, headers });
  }
}
