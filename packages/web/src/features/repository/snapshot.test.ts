/**
 * URL segments and the
 * `?snapshot=` rule.
 */
import { describe, expect, it } from "vitest";
import {
  latestPointerPath,
  needsLowercase,
  parseRepoParams,
  parseSnapshotParam,
  repoIdFromPathname,
} from "./repo-name";

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
