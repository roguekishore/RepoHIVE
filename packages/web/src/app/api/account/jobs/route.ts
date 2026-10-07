import { resolveSession } from "@/server/auth/accounts";
import { authContext, jsonResponse } from "@/server/auth/http";
import { getJobLedger } from "@/server/hosting/clients";
import { listAccountJobs } from "@/server/jobs/list-account-jobs";

export const dynamic = "force-dynamic";

/**
 * The signed-in account's jobs, newest first. Not under `/api/jobs/*`, which CloudFront routes
 * on its own; this path takes the default behaviour (the app box, nothing cached).
 */
export async function GET(request: Request) {
  const { db, sessionToken } = authContext(request);
  const session = resolveSession(db, sessionToken);
  if (session === null) {
    return jsonResponse({ code: "UNAUTHENTICATED", message: "Sign in to see your jobs." }, { status: 401 });
  }
  const list = await listAccountJobs(db, getJobLedger(), session.accountId);
  return jsonResponse(list, { status: 200, headers: { "Cache-Control": "no-store" } });
}
