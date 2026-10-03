import { signIn } from "@/server/auth/accounts";
import { authContext, guardStateChanging, jsonResponse, readJsonBody } from "@/server/auth/http";
import { buildSessionSetCookie } from "@/server/auth/session-cookie";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originBlock = guardStateChanging(request);
  if (originBlock !== undefined) {
    return originBlock;
  }

  const body = (await readJsonBody(request)) as { email?: unknown; password?: unknown } | undefined;
  if (body === undefined || typeof body.email !== "string" || typeof body.password !== "string") {
    return jsonResponse({ code: "BAD_REQUEST", message: "Expected email and password." }, { status: 400 });
  }

  const { config, db, ip } = authContext(request);
  const result = signIn(db, ip, body.email, body.password);
  if (result.kind === "rejected") {
    const status = result.code === "SIGNIN_LOCKED" ? 429 : 401;
    return jsonResponse({ code: result.code, message: result.message }, { status });
  }

  const headers = new Headers();
  headers.set("Set-Cookie", buildSessionSetCookie(result.sessionToken, result.expiresAt, config.mode));
  return jsonResponse({ ok: true }, { status: 200, headers });
}
