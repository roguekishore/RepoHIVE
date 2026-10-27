import { resolveSession } from "../auth/accounts";
import { authContext, jsonResponse } from "../auth/http";
import { getJobLedger } from "../hosting/clients";
import { listAccountJobs } from "../jobs/list-account-jobs";


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
