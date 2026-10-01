import { resolveSession } from "@/lib/auth/accounts";
import { authContext, jsonResponse } from "@/lib/auth/http";
import { remainingQuota } from "@/lib/quota/quota";

export const dynamic = "force-dynamic";

/** Requirement 7.5: remaining accepted requests for the signed-in account and IP. */
export async function GET(request: Request) {
  const { config, db, ip, sessionToken } = authContext(request);
  const session = resolveSession(db, sessionToken);
  if (session === null) {
    return jsonResponse({ code: "UNAUTHENTICATED", message: "Sign in to view quota." }, { status: 401 });
  }

  const remaining = remainingQuota(db, session.accountId, ip, config.quota);
  return jsonResponse(
    {
      remainingAccount: remaining.accountRemaining,
      remainingIp: remaining.ipRemaining,
      limitAccount: remaining.accountLimit,
      limitIp: remaining.ipLimit,
    },
    { status: 200 },
  );
}
