/**
 * URL segments, the
 * `?snapshot=` rule and snapshot resolution.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  latestPointerPath,
  needsLowercase,
  parseRepoParams,
  parseSnapshotParam,
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

  it("builds the latest pointer path", () => {
    expect(latestPointerPath("local/sample")).toBe("/r/github.com/local/sample/latest.json");
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

  it("uses latest.json when no snapshot is requested", async () => {
    const fetched = stubFetch({
      "/r/github.com/local/sample/latest.json": { status: 200, body: { snapshotId: ID, commitSha: "abc" } },
    });
    expect(await resolveSnapshot("local/sample", undefined)).toEqual({
      status: "ready",
      snapshotId: ID,
      source: "latest",
      commitSha: "abc",
    });
    expect(fetched).toEqual(["/r/github.com/local/sample/latest.json"]);
  });

  it("uses a requested snapshot that exists, without reading latest.json", async () => {
    const fetched = stubFetch({ [`/s/${ID}/manifest.json`]: { status: 200, body: {} } });
    expect(await resolveSnapshot("local/sample", ID)).toEqual({ status: "ready", snapshotId: ID, source: "query" });
    expect(fetched).toEqual([`/s/${ID}/manifest.json`]);
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
    stubFetch({ "/r/github.com/local/sample/latest.json": { status: 200, body: { snapshotId: "nope" } } });
    expect((await resolveSnapshot("local/sample", undefined)).status).toBe("error");
    stubFetch({ "/r/github.com/local/sample/latest.json": { status: 500 } });
    expect((await resolveSnapshot("local/sample", undefined)).status).toBe("error");
  });
});
