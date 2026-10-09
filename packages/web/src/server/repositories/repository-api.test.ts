import { describe, expect, it } from "vitest";
import type { ListedRepository } from "./list-indexed-repositories";
import { findListedRepository, parsePageParam, toRepositoryPage, toRepositorySummary } from "./repository-api";

const listed = (repoId: string, indexedAt = "2026-10-07T00:00:00.000Z"): ListedRepository => ({
  repoKey: `github.com/${repoId}`,
  repoId,
  snapshotId: "a".repeat(32),
  commitSha: "c".repeat(40),
  indexedAt,
  nodeCount: 7,
});

describe("parsePageParam", () => {
  it("reads the page the way the Java server does", () => {
    expect(parsePageParam(null)).toBe(1);
    expect(parsePageParam("3")).toBe(3);
    expect(parsePageParam(" 2 ")).toBe(2);
    expect(parsePageParam("2.9")).toBe(2);
    for (const bad of ["", "abc", "0", "-4", "NaN", "Infinity"]) {
      expect(parsePageParam(bad), bad).toBe(1);
    }
  });
});

describe("toRepositoryPage", () => {
  it("pages fifty at a time and clamps a page past the end", () => {
    const all = Array.from({ length: 120 }, (_, n) => listed(`acme/r${n}`));
    const second = toRepositoryPage(all, "2");
    expect(second).toMatchObject({ page: 2, totalPages: 3, total: 120 });
    expect(second.items).toHaveLength(50);
    expect(toRepositoryPage(all, "99")).toMatchObject({ page: 3 });
    expect(toRepositoryPage(all, "99").items).toHaveLength(20);
  });

  it("is one empty page when nothing is indexed", () => {
    expect(toRepositoryPage([], null)).toEqual({ items: [], page: 1, totalPages: 1, total: 0 });
  });
});

describe("findListedRepository", () => {
  const all = [listed("acme/widgets"), listed("other/thing")];

  it("finds a repository by owner and name, in any case", () => {
    expect(findListedRepository(all, "acme", "widgets")?.repoId).toBe("acme/widgets");
    expect(findListedRepository(all, "ACME", "Widgets")?.repoId).toBe("acme/widgets");
  });

  it("finds nothing for an unindexed repository or a name GitHub would not allow", () => {
    expect(findListedRepository(all, "acme", "nope")).toBeUndefined();
    expect(findListedRepository(all, "bad_owner", "widgets")).toBeUndefined();
    expect(findListedRepository(all, "acme", "..")).toBeUndefined();
  });
});

describe("toRepositorySummary", () => {
  it("carries the recorded facts and no edge count", () => {
    expect(toRepositorySummary(listed("acme/widgets"))).toEqual({
      repo: "acme/widgets",
      snapshotId: "a".repeat(32),
      commitSha: "c".repeat(40),
      nodeCount: 7,
      indexedAt: "2026-10-07T00:00:00.000Z",
    });
  });
});
