import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { needsLowercase } from "@/lib/snapshot/repo-name";

/**
 * hosting-3 Requirement 3.2: `/repos/<owner>/<repo>/...` is canonical in
 * lowercase, so a URL with uppercase letters in the owner or repository is
 * redirected permanently to the lowercase one, keeping the rest of the path and
 * the query. (This replaces the old `/api/*` proxy middleware, Requirement 2.5.)
 * Names GitHub would not allow are not touched here; the repository layout
 * answers them with a 404.
 */
export function middleware(request: NextRequest) {
  const segments = request.nextUrl.pathname.split("/");
  // ["", "repos", owner, repo, ...]
  const owner = segments[2];
  const repo = segments[3];
  if (owner !== undefined && repo !== undefined && needsLowercase(owner, repo)) {
    const target = request.nextUrl.clone();
    segments[2] = owner.toLowerCase();
    segments[3] = repo.toLowerCase();
    target.pathname = segments.join("/");
    return NextResponse.redirect(target, 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/repos/:owner/:repo", "/repos/:owner/:repo/:path*"],
};
