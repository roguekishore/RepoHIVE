/** State-changing requests must match the configured site origin. */
export function originMatchesSite(request: Request, siteOrigin: string): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) {
    return false;
  }
  return origin === siteOrigin;
}

export class OriginRejectedError extends Error {
  constructor() {
    super("origin rejected");
    this.name = "OriginRejectedError";
  }
}

export function assertSameOrigin(request: Request, siteOrigin: string): void {
  if (!originMatchesSite(request, siteOrigin)) {
    throw new OriginRejectedError();
  }
}
