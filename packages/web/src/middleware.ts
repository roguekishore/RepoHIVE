import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DEFAULT_REPO_VIEW } from "@/features/repository/default-view";
import { needsLowercase, parseRepoParams } from "@/features/repository/repo-name";

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
/**
 * A redirect with a relative `Location`. `NextResponse.redirect` needs an absolute URL, and behind the proxy the
 * standalone server builds `request.nextUrl` from its own bind address, so a cloned URL sent visitors to
 * `https://localhost:3000/...`. A relative `Location` is resolved by the browser against the host it used.
 */
function redirectTo(request: NextRequest, pathname: string, status: 307 | 308) {
  return new NextResponse(null, { status, headers: { Location: `${pathname}${request.nextUrl.search}` } });
}

export function middleware(request: NextRequest) {
  const segments = request.nextUrl.pathname.split("/");
  // ["", "repos", owner, repo, ...surface]
  const owner = segments[2] ?? "";
  const repo = segments[3] ?? "";

  if (parseRepoParams(owner, repo).kind === "invalid") {
    return NextResponse.rewrite(new URL("/not-found", request.url), { status: 404 });
  }

  if (needsLowercase(owner, repo)) {
    segments[2] = owner.toLowerCase();
    segments[3] = repo.toLowerCase();
    return redirectTo(request, segments.join("/"), 308);
  }

  if (segments.length === 4 || (segments.length === 5 && segments[4] === "")) {
    return redirectTo(request, `/repos/${owner}/${repo}/${DEFAULT_REPO_VIEW}`, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/repos/:owner/:repo", "/repos/:owner/:repo/:path*"],
};
