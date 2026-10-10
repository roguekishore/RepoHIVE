/**
 * URL segments, the
 * shell's path rules, the `?snapshot=` rule and snapshot resolution.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  artifactPath,
  needsLowercase,
  parseRepoParams,
  parseRepoPath,
  parseSnapshotParam,
  repoApiPath,
  repoIdFromPathname,
} from "./repo-name";
import { resolveSnapshot } from "./snapshot-context";

const ID = "0123456789abcdef0123456789abcdef";

describe("parseRepoParams", () => {
  it("lowercases valid names into the repo id", () => {
    expect(parseRepoParams("Local", "Sample-Java.Project")).toEqual({
      kind: "ok",
      owner: "local",
      repo: "sample-java.project",
      repoId: "local/sample-java.project",
    });
  });

  it("rejects characters GitHub does not allow", () => {
    for (const [owner, repo] of [
      ["a_b", "r"],
      ["a.b", "r"],
      ["owner", "re po"],
      ["owner", ".."],
      ["owner", "."],
      ["", "repo"],
      ["x".repeat(40), "repo"],
      ["owner", "r".repeat(101)],
    ] as const) {
      expect(parseRepoParams(owner, repo), `${owner}/${repo}`).toEqual({ kind: "invalid" });
    }
  });

  it("flags a non-canonical (uppercase) URL", () => {
    expect(needsLowercase("Owner", "repo")).toBe(true);
    expect(needsLowercase("owner", "Repo")).toBe(true);
    expect(needsLowercase("owner", "repo")).toBe(false);
  });
});

describe("parseSnapshotParam", () => {
  it("accepts only 32 lowercase hex characters", () => {
    expect(parseSnapshotParam(ID)).toBe(ID);
    expect(parseSnapshotParam(ID.toUpperCase())).toBeUndefined();
    expect(parseSnapshotParam(ID.slice(1))).toBeUndefined();
    expect(parseSnapshotParam(`${ID}0`)).toBeUndefined();
    expect(parseSnapshotParam("../etc")).toBeUndefined();
    expect(parseSnapshotParam(null)).toBeUndefined();
  });
});

describe("paths", () => {
  it("reads the repo id from a repo route pathname", () => {
    expect(repoIdFromPathname("/repos/local/sample/knowledge-graph")).toBe("local/sample");
    expect(repoIdFromPathname("/repos/local/sample")).toBe("local/sample");
    expect(repoIdFromPathname("/repos/local")).toBeUndefined();
    expect(repoIdFromPathname("/")).toBeUndefined();
  });

  it("builds the server and artifact paths", () => {
    expect(repoApiPath("acme/widgets")).toBe("/api/repos/acme/widgets");
    expect(artifactPath("acme/widgets", ID, "views/zoom-map.json")).toBe(`/artifacts/acme/widgets/${ID}/views/zoom-map.json`);
  });
});

describe("parseRepoPath (the shell's reading of the browser path)", () => {
  it("reads a valid surface path with no redirect", () => {
    expect(parseRepoPath("/repos/acme/widgets/hierarchy")).toEqual({
      kind: "ok",
      repoId: "acme/widgets",
      surface: ["hierarchy"],
      needsLowercase: false,
      bare: false,
      redirectTo: undefined,
    });
  });

  it("redirects uppercase owner or repo to the lowercase URL, keeping the rest of the path", () => {
    const parsed = parseRepoPath("/repos/Acme/Widgets/Hierarchy");
    expect(parsed).toMatchObject({ kind: "ok", repoId: "acme/widgets", needsLowercase: true, redirectTo: "/repos/acme/widgets/Hierarchy" });
  });

  it("redirects the bare repository URL, with or without a trailing slash, to the default surface", () => {
    for (const path of ["/repos/acme/widgets", "/repos/acme/widgets/"]) {
      expect(parseRepoPath(path), path).toMatchObject({ kind: "ok", bare: true, surface: [], redirectTo: "/repos/acme/widgets/knowledge-graph" });
    }
    expect(parseRepoPath("/repos/Acme/Widgets")).toMatchObject({ redirectTo: "/repos/acme/widgets/knowledge-graph" });
  });

  it("rejects names GitHub would not allow", () => {
    for (const path of ["/repos/acme/inva!id/hierarchy", "/repos/a_b/r/hierarchy", "/repos/acme/../x", "/repos//r/x", "/repos/acme/%E0%A4%A/x"]) {
      expect(parseRepoPath(path), path).toEqual({ kind: "invalid" });
    }
  });

  it("is not a repository path outside /repos/<owner>/<repo>", () => {
    for (const path of ["/", "/jobs/abc", "/repos", "/repos/acme", undefined, null]) {
      expect(parseRepoPath(path), String(path)).toEqual({ kind: "not-repo" });
    }
  });
});

describe("resolveSnapshot", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(routes: Record<string, { status: number; body?: unknown }>) {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(url);
        const route = routes[url] ?? { status: 404 };
        return new Response(route.body === undefined ? null : JSON.stringify(route.body), { status: route.status });
      }),
    );
    return fetched;
  }

  it("uses the server's answer when no snapshot is requested", async () => {
    const fetched = stubFetch({
      "/api/repos/local/sample": {
        status: 200,
        body: { repo: "local/sample", snapshotId: ID, commitSha: "abc", nodeCount: 1, edgeCount: 2, indexedAt: "2026-01-01T00:00:00Z" },
      },
    });
    expect(await resolveSnapshot("local/sample", undefined)).toEqual({
      status: "ready",
      snapshotId: ID,
      source: "latest",
      commitSha: "abc",
    });
    expect(fetched).toEqual(["/api/repos/local/sample"]);
  });

  it("uses a requested snapshot that exists, without asking which one is active", async () => {
    const fetched = stubFetch({ [`/artifacts/local/sample/${ID}/manifest.json`]: { status: 200, body: {} } });
    expect(await resolveSnapshot("local/sample", ID)).toEqual({ status: "ready", snapshotId: ID, source: "query" });
    expect(fetched).toEqual([`/artifacts/local/sample/${ID}/manifest.json`]);
  });

  it("reports an expired snapshot when the requested one is gone", async () => {
    stubFetch({});
    expect(await resolveSnapshot("local/sample", ID)).toEqual({ status: "expired", requested: ID });
  });

  it("reports a repository that was never indexed", async () => {
    stubFetch({});
    expect(await resolveSnapshot("local/sample", undefined)).toEqual({ status: "never-indexed" });
  });

  it("reports a malformed pointer and a failing server as errors", async () => {
    stubFetch({ "/api/repos/local/sample": { status: 200, body: { snapshotId: "nope" } } });
    expect((await resolveSnapshot("local/sample", undefined)).status).toBe("error");
    stubFetch({ "/api/repos/local/sample": { status: 500 } });
    expect((await resolveSnapshot("local/sample", undefined)).status).toBe("error");
  });
});
