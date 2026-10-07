// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RepositoryListItem } from "@repohive/design/contracts";
import { navigationGroups } from "./palette-groups";

const repo = (repoId: string): RepositoryListItem => ({
  repoKey: `github.com/${repoId}`,
  repoId,
  snapshotId: "0123456789abcdef0123456789abcdef",
  commitSha: "c".repeat(40),
  indexedAt: "2026-10-07T00:00:00.000Z",
  nodeCount: 1,
});

const labels = (groups: ReturnType<typeof navigationGroups>, group: string) =>
  groups.find((entry) => entry.label === group)?.items.map((item) => item.label);

describe("navigationGroups", () => {
  it("lists the pages, Activity included, and no views outside a repository", () => {
    const groups = navigationGroups("/repos", [], "");
    expect(labels(groups, "Pages")).toEqual(["Repositories", "Activity", "Method"]);
    expect(labels(groups, "Views")).toEqual([]);
  });

  it("lists the views of the repository the visitor is in, as links to it", () => {
    const groups = navigationGroups("/repos/acme/widgets/hierarchy", [], "");
    expect(labels(groups, "Views")?.[0]).toBe("Overview");
    expect(labels(groups, "Views")).toHaveLength(8);
    const map = groups.find((group) => group.label === "Views")?.items.find((item) => item.label === "Map");
    expect(map).toMatchObject({ href: "/repos/acme/widgets/knowledge-graph", meta: "acme/widgets" });
  });

  it("links a repository to its root", () => {
    const groups = navigationGroups("/repos", [repo("acme/widgets")], "");
    expect(groups.find((group) => group.label === "Repositories")?.items).toEqual([
      { id: "repo:acme/widgets", label: "acme/widgets", icon: "repo", href: "/repos/acme/widgets" },
    ]);
  });

  it("ranks by the query and drops what does not match", () => {
    const groups = navigationGroups("/repos", [repo("acme/widgets"), repo("zeta/gadgets"), repo("acme/other")], "acme");
    expect(labels(groups, "Repositories")).toEqual(["acme/other", "acme/widgets"]);
    expect(labels(groups, "Pages")).toEqual([]);
  });
});
