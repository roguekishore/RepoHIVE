import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { needsLowercase, parseRepoParams } from "@/lib/snapshot/repo-name";

/**
 * Repository URL rules that must be answered before any page renders, so the
 * HTTP status is right (a layout or page that redirects or 404s after the
 * loading shell has streamed answers 200).
 *
 * - `/repos/<owner>/<repo>/...` is canonical in lowercase; a
 *   URL with uppercase letters in the owner or repository redirects permanently
 *   to the lowercase one, keeping the rest of the path and the query.
 * - An owner or repository GitHub would not allow is a 404.
 * - `/repos/<owner>/<repo>` redirects to the default surface.
 *
 * This replaces the old `/api/*` proxy middleware.
 */
export function middleware(request: NextRequest) {
  const segments = request.nextUrl.pathname.split("/");
  // ["", "repos", owner, repo, ...surface]
  const owner = segments[2] ?? "";
  const repo = segments[3] ?? "";

  if (parseRepoParams(owner, repo).kind === "invalid") {
    return NextResponse.rewrite(new URL("/not-found", request.url), { status: 404 });
  }

  if (needsLowercase(owner, repo)) {
    const target = request.nextUrl.clone();
    segments[2] = owner.toLowerCase();
    segments[3] = repo.toLowerCase();
    target.pathname = segments.join("/");
    return NextResponse.redirect(target, 308);
  }

  if (segments.length === 4 || (segments.length === 5 && segments[4] === "")) {
    const target = request.nextUrl.clone();
    target.pathname = `/repos/${owner}/${repo}/knowledge-graph`;
    return NextResponse.redirect(target, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/repos/:owner/:repo", "/repos/:owner/:repo/:path*"],
};
