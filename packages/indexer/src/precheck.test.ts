/**
 * The pre-check on a mocked GitHub API (hosting-2 Requirements 2 and 13.5).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createMemoryArtifactStore } from "./artifact-store-memory.js";
import type { FetchFunction } from "./github.js";
import { buildLatest, jsonBytes, latestKey, snapshotIdOf } from "./layout.js";
import { parseRepositoryReference, precheck, type PrecheckDeps, type PrecheckResult } from "./precheck.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const VIEWS = "views-v1";
const ENGINE = "engine-v1";
const CONFIG = "config-v1";

interface Tree {
  tree: { path: string; type: string; size: number }[];
  truncated?: boolean;
}

interface Mock {
  repo?: unknown;
  repoStatus?: number;
  commitStatus?: number;
  tree?: Tree;
  throwOn?: string;
}

function javaTree(count: number, size = 100): Tree {
  return {
    tree: [
      { path: "README.md", type: "blob", size: 5 },
      { path: "src", type: "tree", size: 0 },
      ...Array.from({ length: count }, (_, i) => ({ path: `src/C${i}.java`, type: "blob", size })),
    ],
  };
}

function mockFetch(mock: Mock, calls: string[] = []): FetchFunction {
  return async (url, init) => {
    calls.push(url);
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer server-token");
    assert.equal(headers["X-GitHub-Api-Version"], "2022-11-28");
    if (mock.throwOn !== undefined && url.includes(mock.throwOn)) {
      throw new Error("network down");
    }
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body ?? {}), { status });
    if (url.includes("/git/trees/")) {
      return json(200, mock.tree ?? javaTree(3));
    }
    if (url.includes("/commits/")) {
      return mock.commitStatus === undefined ? json(200, { sha: SHA }) : json(mock.commitStatus, {});
    }
    if (mock.repoStatus !== undefined) {
      return json(mock.repoStatus, {});
    }
    return json(200, mock.repo ?? { private: false, archived: false, default_branch: "main" });
  };
}

function deps(mock: Mock, extra: Partial<PrecheckDeps> = {}, calls?: string[]): PrecheckDeps {
  return {
    token: "server-token",
    store: createMemoryArtifactStore(),
    viewsVersion: VIEWS,
    engineVersion: ENGINE,
    configDigest: CONFIG,
    fetch: mockFetch(mock, calls),
    ...extra,
  };
}

function rejected(result: PrecheckResult, reason: string): void {
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, reason);
  assert.ok(result.message.length > 0);
}

describe("repository reference", () => {
  test("accepts the URL and the short form, lowercasing the repo", () => {
    assert.deepEqual(parseRepositoryReference("https://github.com/Acme/Widgets"), { owner: "Acme", repo: "widgets" });
    assert.deepEqual(parseRepositoryReference("acme/widgets"), { owner: "acme", repo: "widgets" });
    assert.deepEqual(parseRepositoryReference(" https://github.com/acme/widgets.git/ "), { owner: "acme", repo: "widgets" });
  });

  test("rejects anything else", () => {
    for (const bad of [
      "",
      "acme",
      "http://github.com/acme/widgets",
      "https://gitlab.com/acme/widgets",
      "https://github.com/acme/widgets/tree/main",
      "acme/..",
      "../widgets",
      "ac me/widgets",
      "-/a/b",
      "acme/wid gets",
      `${"a".repeat(40)}/widgets`,
    ]) {
      assert.equal(parseRepositoryReference(bad), undefined, bad);
    }
  });
});

describe("precheck", () => {
  test("an invalid reference is rejected without a GitHub call", async () => {
    const calls: string[] = [];
    rejected(await precheck("not a repo", deps({}, {}, calls)), "invalid-repository");
    assert.equal(calls.length, 0);
  });

  test("resolves the head commit, counts Java files and picks the smallest tier", async () => {
    const calls: string[] = [];
    const result = await precheck("Acme/Widgets", deps({ tree: javaTree(1_001, 10) }, {}, calls));
    assert.ok(result.ok);
    assert.equal(result.repo, "github.com/acme/widgets");
    assert.equal(result.commitSha, SHA);
    assert.equal(result.javaFiles, 1_001);
    assert.equal(result.javaBytes, 10_010);
    assert.equal(result.tier, "M");
    assert.equal(result.cacheHit, false);
    assert.equal(result.truncated, false);
    assert.equal(
      result.snapshotId,
      snapshotIdOf({ repo: "github.com/acme/widgets", commitSha: SHA, engineVersion: ENGINE, viewsVersion: VIEWS, configDigest: CONFIG }),
    );
    assert.deepEqual(calls, [
      "https://api.github.com/repos/Acme/widgets",
      "https://api.github.com/repos/Acme/widgets/commits/main",
      `https://api.github.com/repos/Acme/widgets/git/trees/${SHA}?recursive=1`,
    ]);
  });

  test("tier boundaries: 1,000 is S, 5,000 is M, 15,000 is L, 30,000 is XL", async () => {
    for (const [count, tier] of [[1_000, "S"], [5_000, "M"], [15_000, "L"], [30_000, "XL"]] as const) {
      const result = await precheck("acme/widgets", deps({ tree: javaTree(count, 1) }));
      assert.ok(result.ok);
      assert.equal(result.tier, tier);
    }
  });

  test("applies the engine's selection policy to each blob path", async () => {
    const tree: Tree = {
      tree: [
        { path: "src/A.java", type: "blob", size: 10 },
        { path: "node_modules/x/B.java", type: "blob", size: 10 },
        { path: "src/C.JAVA", type: "blob", size: 10 },
        { path: "src/java", type: "tree", size: 0 },
      ],
    };
    const result = await precheck("acme/widgets", deps({ tree }));
    assert.ok(result.ok);
    assert.equal(result.javaFiles, 1);
  });

  test("more than 30,000 files, or more than 250 MB of Java, is rejected", async () => {
    rejected(await precheck("acme/widgets", deps({ tree: javaTree(30_001, 1) })), "too-large");
    rejected(await precheck("acme/widgets", deps({ tree: javaTree(2, 126 * 1024 * 1024) })), "too-large");
  });

  test("no Java files is rejected", async () => {
    rejected(await precheck("acme/widgets", deps({ tree: { tree: [{ path: "a.md", type: "blob", size: 1 }] } })), "no-java-files");
  });

  test("a truncated tree is XL, and leaves enforcement to the fetch caps", async () => {
    const result = await precheck("acme/widgets", deps({ tree: { ...javaTree(2), truncated: true } }));
    assert.ok(result.ok);
    assert.equal(result.tier, "XL");
    assert.equal(result.truncated, true);
    const empty = await precheck("acme/widgets", deps({ tree: { tree: [], truncated: true } }));
    assert.ok(empty.ok);
    assert.equal(empty.tier, "XL");
  });

  test("a missing repository, a private one and one with no default branch are rejected", async () => {
    rejected(await precheck("acme/widgets", deps({ repoStatus: 404 })), "not-found");
    rejected(await precheck("acme/widgets", deps({ repo: { private: true, default_branch: "main" } })), "private");
    rejected(await precheck("acme/widgets", deps({ repo: { archived: true, default_branch: null } })), "no-default-branch");
    rejected(await precheck("acme/widgets", deps({ repo: { archived: true } })), "no-default-branch");
  });

  test("an archived repository with a default branch is indexed", async () => {
    const result = await precheck("acme/widgets", deps({ repo: { archived: true, default_branch: "main" } }));
    assert.ok(result.ok);
  });

  test("an empty repository, a rate limit and a network failure each get a typed reason", async () => {
    rejected(await precheck("acme/widgets", deps({ commitStatus: 409 })), "empty-repository");
    rejected(await precheck("acme/widgets", deps({ repoStatus: 403 })), "github-unavailable");
    rejected(await precheck("acme/widgets", deps({ throwOn: "/commits/" })), "github-unavailable");
  });

  test("a cache hit needs latest.json to name this exact snapshot", async () => {
    const store = createMemoryArtifactStore();
    const snapshotId = snapshotIdOf({
      repo: "github.com/acme/widgets",
      commitSha: SHA,
      engineVersion: ENGINE,
      viewsVersion: VIEWS,
      configDigest: CONFIG,
    });
    const put = (id: string): Promise<void> =>
      store.put(
        latestKey("github.com/acme/widgets"),
        jsonBytes(
          buildLatest(
            { repo: "github.com/acme/widgets", snapshotId: id, commitSha: SHA, engineVersion: ENGINE, viewsVersion: VIEWS },
            new Date(0),
          ),
        ),
        { contentType: "application/json" },
      );

    await put("f".repeat(32));
    const miss = await precheck("acme/widgets", deps({}, { store }));
    assert.ok(miss.ok);
    assert.equal(miss.cacheHit, false);

    await put(snapshotId);
    const hit = await precheck("acme/widgets", deps({}, { store }));
    assert.ok(hit.ok);
    assert.equal(hit.cacheHit, true);
    assert.equal(hit.snapshotId, snapshotId);

    // A new engine or views version is a different snapshot even for the same commit.
    const newer = await precheck("acme/widgets", deps({}, { store, viewsVersion: "views-v2" }));
    assert.ok(newer.ok);
    assert.equal(newer.cacheHit, false);
  });

  test("an unreadable latest.json is a miss, not a failure", async () => {
    const store = createMemoryArtifactStore();
    await store.put(latestKey("github.com/acme/widgets"), Buffer.from("{not json"), { contentType: "application/json" });
    const result = await precheck("acme/widgets", deps({}, { store }));
    assert.ok(result.ok);
    assert.equal(result.cacheHit, false);
  });
});
