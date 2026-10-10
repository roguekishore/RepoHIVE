/**
 * Repo URL rules answered before any page
 * renders. Uppercase owner or repository is a permanent redirect to the
 * lowercase URL (path and query kept); disallowed characters are a 404; the
 * repo root redirects to the default surface.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_REPO_VIEW } from "@/features/repository/default-view";
import { config, middleware } from "./middleware";

function run(url: string) {
  return middleware(new NextRequest(url));
}

describe("repo URL rules", () => {
  it("redirects permanently, keeping the surface and the query", () => {
    const response = run("http://localhost:3000/repos/Local/Sample-Java/knowledge-graph?focus=Abc&snapshot=0123456789abcdef0123456789abcdef");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/repos/local/sample-java/knowledge-graph?focus=Abc&snapshot=0123456789abcdef0123456789abcdef",
    );
  });

  it("lowercases the repo root before redirecting it, and only the owner and repo", () => {
    expect(run("http://localhost:3000/repos/OWNER/repo").headers.get("location")).toBe(
      "http://localhost:3000/repos/owner/repo",
    );
    expect(run("http://localhost:3000/repos/a/b/files/SrcDir/Main.java").status).toBe(200);
  });

  it("passes canonical URLs through", () => {
    const response = run("http://localhost:3000/repos/local/sample-java/hierarchy");
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects the repo root to the default view, keeping the query", () => {
    const response = run("http://localhost:3000/repos/owner/repo?snapshot=0123456789abcdef0123456789abcdef");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `http://localhost:3000/repos/owner/repo/${DEFAULT_REPO_VIEW}?snapshot=0123456789abcdef0123456789abcdef`,
    );
  });

  it("sends the repo root to the Overview", () => {
    expect(run("http://localhost:3000/repos/owner/repo").headers.get("location")).toBe("http://localhost:3000/repos/owner/repo/overview");
  });

  it("answers names GitHub would not allow with a 404", () => {
    for (const path of ["bad_owner/repo/hierarchy", "owner/bad%40name/hierarchy", "owner/bad%40name", "owner/../x"]) {
      expect(run(`http://localhost:3000/repos/${path}`).status, path).toBe(404);
    }
  });

  it("only runs for repo routes", () => {
    expect(config.matcher).toEqual(["/repos/:owner/:repo", "/repos/:owner/:repo/:path*"]);
  });
});
