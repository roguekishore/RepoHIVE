import { resolveSession } from "@/server/auth/accounts";
import { authContext, jsonResponse } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** Lightweight session probe for client screens (Requirement 13). */
export async function GET(request: Request) {
  const { db, sessionToken } = authContext(request);
  const session = resolveSession(db, sessionToken);
  if (session === null) {
    return jsonResponse({ signedIn: false }, { status: 200 });
  }
  const row = db.prepare("SELECT email FROM accounts WHERE id = ?").get(session.accountId) as
    | { email: string }
    | undefined;
  if (row === undefined) {
    return jsonResponse({ signedIn: false }, { status: 200 });
  }
  return jsonResponse({ signedIn: true, email: row.email }, { status: 200 });
}
