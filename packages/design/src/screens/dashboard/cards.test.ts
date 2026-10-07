import { describe, expect, it } from "vitest";
import type { JobListItem, RepositoryListItem } from "../../contracts";
import { NO_FILTER, buildCards, cardSize, filterCards, sortCards } from "./cards";
import type { RepoFigures } from "./figures";

const repo = (repoId: string, indexedAt: string, snapshot = "a"): RepositoryListItem => ({
  repoKey: `github.com/${repoId}`,
  repoId,
  snapshotId: snapshot.repeat(32).slice(0, 32),
  commitSha: "c".repeat(40),
  indexedAt,
  nodeCount: 10,
});

const job = (jobId: string, repoId: string, patch: Partial<JobListItem> = {}): JobListItem => ({
  jobId,
  repo: `github.com/${repoId}`,
  state: "succeeded",
  tier: "M",
  requestedAt: "2026-10-07T08:00:00.000Z",
  ...patch,
});

const figs = (patch: Partial<RepoFigures>): RepoFigures => ({
  files: 100,
  regions: 10,
  assessed: 8,
  preserved: 4,
  reconstructed: 4,
  degenerate: 2,
  preserveShare: 0.5,
  ...patch,
});

const list = [repo("acme/widgets", "2026-10-06T00:00:00.000Z", "1"), repo("acme/gadgets", "2026-10-05T00:00:00.000Z", "2")];

describe("buildCards", () => {
  it("makes one ok card per repository when nobody is signed in", () => {
    const cards = buildCards(list, undefined);
    expect(cards.map((card) => [card.repoId, card.status, card.href])).toEqual([
      ["acme/widgets", "ok", "/repos/acme/widgets"],
      ["acme/gadgets", "ok", "/repos/acme/gadgets"],
    ]);
  });

  it("marks a repository running or failed from the newest job for it, and opens the job while it runs", () => {
    const jobs = {
      items: [
        job("new", "acme/widgets", { state: "parsing", progress: { stage: "parsing", completed: 1, total: 4 } }),
        job("old", "acme/widgets", { state: "failed", failure: { code: "X" } }),
        job("bad", "acme/gadgets", { state: "failed", failure: { code: "REPO_TOO_LARGE" } }),
      ],
    };
    const [widgets, gadgets] = buildCards(list, jobs);
    expect(widgets).toMatchObject({ status: "run", href: "/jobs/new" });
    expect(gadgets).toMatchObject({ status: "err", href: "/repos/acme/gadgets" });
  });

  it("adds a card for a repository only in the job list while running or after failing, not after succeeding", () => {
    const jobs = {
      items: [
        job("a", "elastic/search", { state: "grouping" }),
        job("b", "apache/groovy", { state: "failed", failure: { code: "CLONE_TIMEOUT" }, requestedAt: "2026-10-02T11:20:00.000Z" }),
        job("c", "square/okhttp", { state: "succeeded" }),
      ],
    };
    const cards = buildCards(list, jobs);
    expect(cards.map((card) => card.repoId)).toEqual(["acme/widgets", "acme/gadgets", "elastic/search", "apache/groovy"]);
    expect(cards[3]).toMatchObject({ status: "err", href: "/jobs/b", time: "2026-10-02T11:20:00.000Z" });
    expect(cards[3]?.indexed).toBeUndefined();
  });
});

describe("filter and sort", () => {
  const jobs = {
    items: [
      job("bad", "acme/gadgets", { state: "failed", failure: { code: "X" } }),
      job("q", "elastic/search", { state: "queued", tier: "XL" }),
    ],
  };
  const cards = buildCards(list, jobs);
  const known: Record<string, RepoFigures> = {
    "acme/widgets": figs({ files: 5200, preserveShare: 0.9 }),
    "acme/gadgets": figs({ files: 300, preserveShare: 0.2 }),
  };
  const figuresOf = (card: { repoId: string }): RepoFigures | undefined => known[card.repoId];
  const ids = (found: readonly { repoId: string }[]): string[] => found.map((card) => card.repoId);

  it("matches the filter against owner and name", () => {
    expect(ids(filterCards(cards, { ...NO_FILTER, query: " GADG " }, figuresOf))).toEqual(["acme/gadgets"]);
    expect(filterCards(cards, { ...NO_FILTER, query: "acme/" }, figuresOf)).toHaveLength(2);
  });

  it("filters by size class: the recorded file count, else the job tier, else out", () => {
    expect(cardSize(cards[0]!, figuresOf(cards[0]!))).toBe("L");
    expect(cardSize(cards[2]!, undefined)).toBe("XL");
    expect(ids(filterCards(cards, { ...NO_FILTER, sizes: ["S"] }, figuresOf))).toEqual(["acme/gadgets"]);
    expect(ids(filterCards(cards, { ...NO_FILTER, sizes: ["L", "XL"] }, figuresOf))).toEqual(["acme/widgets", "elastic/search"]);
    expect(filterCards(cards, { ...NO_FILTER, sizes: ["M"] }, () => undefined)).toEqual([]);
  });

  it("needs attention means a failed job", () => {
    expect(ids(filterCards(cards, { ...NO_FILTER, attention: true }, figuresOf))).toEqual(["acme/gadgets"]);
  });

  it("sorts by recency with what runs first, by name, by files and by rebuilt share, ties by id", () => {
    const running = buildCards(list, { items: [job("r", "acme/gadgets", { state: "parsing" })] });
    expect(ids(sortCards(running, "recent", figuresOf))).toEqual(["acme/gadgets", "acme/widgets"]);
    // A queued job is in progress too, so its card leads, then the newest index.
    expect(ids(sortCards(cards, "recent", figuresOf))).toEqual(["elastic/search", "acme/widgets", "acme/gadgets"]);
    expect(ids(sortCards(cards, "name", figuresOf))).toEqual(["acme/gadgets", "acme/widgets", "elastic/search"]);
    expect(ids(sortCards(cards, "files", figuresOf))).toEqual(["acme/widgets", "acme/gadgets", "elastic/search"]);
    expect(ids(sortCards(cards, "rebuilt", figuresOf))).toEqual(["acme/gadgets", "acme/widgets", "elastic/search"]);
  });

  it("does not change its input, and gives the same order for the same input", () => {
    const before = ids(cards);
    const once = sortCards(cards, "files", figuresOf);
    expect(ids(cards)).toEqual(before);
    expect(sortCards(cards, "files", figuresOf)).toEqual(once);
  });
});
