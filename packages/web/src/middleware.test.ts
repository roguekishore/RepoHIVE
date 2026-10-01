/**
 * hosting-3 Requirement 3.2: uppercase owner or repository in a repo URL is a
 * permanent redirect to the lowercase URL, keeping the path and query.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, middleware } from "./middleware";

function run(url: string) {
  return middleware(new NextRequest(url));
}

describe("repo URL lowercase redirect", () => {
  it("redirects permanently, keeping the surface and the query", () => {
    const response = run("http://localhost:3000/repos/Local/Sample-Java/knowledge-graph?focus=Abc&snapshot=0123456789abcdef0123456789abcdef");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/repos/local/sample-java/knowledge-graph?focus=Abc&snapshot=0123456789abcdef0123456789abcdef",
    );
  });

  it("redirects the repo root too, and lowercases only the owner and repo", () => {
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

  it("only runs for repo routes", () => {
    expect(config.matcher).toEqual(["/repos/:owner/:repo", "/repos/:owner/:repo/:path*"]);
  });
});
