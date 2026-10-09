import type { AppConfig } from "@/server/hosting/config";

/**
 * The configured header in hosted mode; in local mode the
 * first address on `X-Forwarded-For`, then `X-Real-IP`, then `127.0.0.1`
 * (Next.js route handlers do not expose the socket).
 */
export function getClientIp(request: Request, config: AppConfig): string {
  if (config.mode === "hosted") {
    const header = config.clientIpHeader;
    if (header === undefined) {
      return "0.0.0.0";
    }
    const value = request.headers.get(header)?.trim();
    return value === undefined || value === "" ? "0.0.0.0" : value;
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded !== "") {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") {
      return first;
    }
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real !== undefined && real !== "") {
    return real;
  }
  return "127.0.0.1";
}
