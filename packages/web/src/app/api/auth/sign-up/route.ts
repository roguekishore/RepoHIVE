import { signUp } from "@/server/auth/accounts";
import { authContext, guardStateChanging, jsonResponse, readJsonBody } from "@/server/auth/http";
import { buildSessionSetCookie } from "@/server/auth/session-cookie";
import { getAppTelemetry } from "@/server/telemetry/app-metrics";

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
  const result = signUp(db, ip, body.email, body.password);
  if (result.kind === "rejected") {
    const status =
      result.code === "SIGNUP_IP_LIMIT" ? 429 : result.code === "EMAIL_TAKEN" ? 409 : 400;
    return jsonResponse({ code: result.code, message: result.message }, { status });
  }

  getAppTelemetry().signUp();

  const headers = new Headers();
  headers.set("Set-Cookie", buildSessionSetCookie(result.sessionToken, result.expiresAt, config.mode));
  return jsonResponse({ ok: true }, { status: 201, headers });
}
