/** Client-safe site origin for state-changing fetches (matches `REPOHIVE_SITE_ORIGIN`). */
export function clientSiteOrigin(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:3000";
}
