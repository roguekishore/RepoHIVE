import { signOut } from "../auth/accounts";
import { authContext, guardStateChanging, jsonResponse } from "../auth/http";
import { buildSessionClearCookie } from "../auth/session-cookie";


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
