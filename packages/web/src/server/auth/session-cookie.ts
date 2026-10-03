import type { AppMode } from "@/server/hosting/config";

/** Requirement 6.2: `__Host-` prefix and `Secure` in hosted mode only. */
export function sessionCookieName(mode: AppMode): string {
  return mode === "hosted" ? "__Host-repohive_session" : "repohive_session";
}

export function parseSessionCookie(request: Request, mode: AppMode): string | undefined {
  const header = request.headers.get("cookie");
  if (header === null) {
    return undefined;
  }
  const name = sessionCookieName(mode);
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1);
    }
  }
  return undefined;
}

export function buildSessionSetCookie(
  token: string,
  expiresAt: string,
  mode: AppMode,
): string {
  const name = sessionCookieName(mode);
  const parts = [
    `${name}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (mode === "hosted") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function buildSessionClearCookie(mode: AppMode): string {
  const name = sessionCookieName(mode);
  const parts = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (mode === "hosted") {
    parts.push("Secure");
  }
  return parts.join("; ");
}
