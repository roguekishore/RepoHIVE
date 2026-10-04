/** The dashboard's read of `GET /api/repos?page=<n>`. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRepositoryPage, parsePageParam, repositoriesPath } from "./listed-repository";

describe("dashboard repository list", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses ?page= as a positive integer, 1 otherwise", () => {
    expect(parsePageParam("3")).toBe(3);
    for (const bad of [null, undefined, "", "0", "-2", "x"]) expect(parsePageParam(bad), String(bad)).toBe(1);
  });

  it("fetches the requested page and returns the body", async () => {
    const body = {
      items: [{ repoKey: "github.com/acme/widgets", repoId: "acme/widgets", snapshotId: "a".repeat(32), commitSha: "abc1234", indexedAt: "2026-01-01T00:00:00Z", nodeCount: 7 }],
      page: 2,
      totalPages: 3,
      total: 120,
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchRepositoryPage(2)).toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith("/api/repos?page=2");
    expect(repositoriesPath(2)).toBe("/api/repos?page=2");
  });

  it("rejects when the server fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    await expect(fetchRepositoryPage(1)).rejects.toThrow("500");
  });
});
