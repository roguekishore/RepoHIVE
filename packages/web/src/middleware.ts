import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * API proxy — OFF by default.
 *
 * The local RepoHIVE viewer serves `/api/*` itself through Next.js Route
 * Handlers that read the `index/` set from disk (no external backend, no
 * database). So this middleware passes requests straight through.
 *
 * It is kept as the "point at your backend" knob (protocol §3.1): set
 * `REPOWISE_PROXY_TARGET` to a backend origin (e.g. a future hosted API) to
 * rewrite `/api/*`, `/health` and `/metrics` there instead. It intentionally
 * does NOT key off `REPOWISE_API_URL` — that variable points the SSR fetch at
 * this same app, so proxying on it would rewrite our own handlers into a loop.
 */
export function middleware(request: NextRequest) {
  const target = process.env.REPOWISE_PROXY_TARGET;
  if (!target) {
    return NextResponse.next();
  }

  const destination = new URL(
    request.nextUrl.pathname + request.nextUrl.search,
    target,
  );

  return NextResponse.rewrite(destination);
}

export const config = {
  matcher: [
    '/api/:path*',
    '/health',
    '/metrics'
  ],
};
