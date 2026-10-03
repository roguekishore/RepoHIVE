import { signOut } from "@/server/auth/accounts";
import { authContext, guardStateChanging, jsonResponse } from "@/server/auth/http";
import { buildSessionClearCookie } from "@/server/auth/session-cookie";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originBlock = guardStateChanging(request);
  if (originBlock !== undefined) {
    return originBlock;
  }

  const { config, db, sessionToken } = authContext(request);
  signOut(db, sessionToken);

  const headers = new Headers();
  headers.set("Set-Cookie", buildSessionClearCookie(config.mode));
  return jsonResponse({ ok: true }, { status: 200, headers });
}
