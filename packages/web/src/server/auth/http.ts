import { getAppDatabase } from "@/server/app-db/database";
import { getAppConfig } from "@/server/hosting/config";
import { getClientIp } from "./client-ip";
import { assertSameOrigin, OriginRejectedError } from "./origin";
import { parseSessionCookie } from "./session-cookie";

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function authContext(request: Request) {
  const config = getAppConfig();
  return {
    config,
    db: getAppDatabase(),
    ip: getClientIp(request, config),
    sessionToken: parseSessionCookie(request, config.mode),
  };
}

export function rejectOrigin(): Response {
  return jsonResponse({ code: "ORIGIN_REJECTED", message: "Origin not allowed." }, { status: 403 });
}

export function guardStateChanging(request: Request): Response | undefined {
  try {
    assertSameOrigin(request, getAppConfig().siteOrigin);
    return undefined;
  } catch (error) {
    if (error instanceof OriginRejectedError) {
      return rejectOrigin();
    }
    throw error;
  }
}
