/**
 * Repository list and pagination.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildLatest,
  createMemoryArtifactStore,
  headersForKey,
  jsonBytes,
  latestKey,
  prepareObject,
  viewKey,
  VIEW_FILES,
} from "@repohive/indexer";
import { openAppDatabase, resetAppDatabaseForTests } from "@/server/app-db/database";
import { parseAppConfig, resetAppConfigForTests } from "@/server/hosting/config";
import { upsertIndexedRepository } from "@/server/worker/repositories";
import {
  listIndexedRepositories,
  paginateRepositories,
  REPOSITORIES_PAGE_SIZE,
} from "./list-indexed-repositories";

describe("listIndexedRepositories", () => {
  let scratch: string;
  let db: ReturnType<typeof openAppDatabase>;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "repohive-repos-"));
    resetAppConfigForTests();
    Object.assign(process.env, {
      REPOHIVE_MODE: "local",
      REPOHIVE_SITE_ORIGIN: "http://localhost:3000",
      REPOHIVE_DATA_DIR: join(scratch, "data"),
      REPOHIVE_STORE: `local:${join(scratch, "store")}`,
      REPOHIVE_LEDGER: `file:${join(scratch, "ledger.json")}`,
      REPOHIVE_ORCHESTRATOR: "local",
    });
    db = openAppDatabase(join(scratch, "app.sqlite"));
    resetAppDatabaseForTests(db);
  });

  afterEach(() => {
    db.close();
    resetAppDatabaseForTests();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("lists sqlite rows newest first and paginates fifty per page", async () => {
    upsertIndexedRepository(db, {
      repo: "github.com/acme/old",
      snapshotId: "a".repeat(32),
      commitSha: "c".repeat(40),
      indexedAt: "2026-01-01T00:00:00.000Z",
      nodeCount: 1,
      jobId: "job-old",
    });
    upsertIndexedRepository(db, {
      repo: "github.com/acme/new",
      snapshotId: "b".repeat(32),
      commitSha: "d".repeat(40),
      indexedAt: "2026-02-01T00:00:00.000Z",
      nodeCount: 2,
      jobId: "job-new",
    });
    const config = parseAppConfig(process.env);
    const store = createMemoryArtifactStore();
    const listed = await listIndexedRepositories(db, config, store);
    expect(listed.map((row) => row.repoId)).toEqual(["acme/new", "acme/old"]);

    const many = Array.from({ length: REPOSITORIES_PAGE_SIZE + 1 }, (_, index) => ({
      repo: `github.com/acme/r${index}`,
      snapshotId: "f".repeat(32),
      commitSha: "e".repeat(40),
      indexedAt: `2026-03-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      nodeCount: index,
      jobId: `job-${index}`,
    }));
    for (const row of many) {
      upsertIndexedRepository(db, row);
    }
    const merged = await listIndexedRepositories(db, config, store);
    const pageOne = paginateRepositories(merged, 1);
    expect(pageOne.items).toHaveLength(REPOSITORIES_PAGE_SIZE);
    expect(pageOne.totalPages).toBeGreaterThan(1);
  });

  it("merges seeded local fixtures from the store when sqlite has no row", async () => {
    const config = parseAppConfig(process.env);
    const store = createMemoryArtifactStore();
    const repoKey = "github.com/local/sample-java-project";
    const snapshotId = "0123456789abcdef0123456789abcdef";
    const pointer = buildLatest(
      {
        repo: repoKey,
        snapshotId,
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        engineVersion: "test",
        viewsVersion: "test",
      },
      new Date("2026-04-01T00:00:00.000Z"),
    );
    await store.put(latestKey(repoKey), jsonBytes(pointer), headersForKey(latestKey(repoKey)));
    // As the indexer stores it: the view is brotli-compressed, and its headers say so.
    const scale = await prepareObject({
      key: viewKey(snapshotId, VIEW_FILES.hierarchyScale),
      content: jsonBytes({ totalNodes: 38 }),
    });
    await store.put(scale.key, scale.body, scale.headers);

    const listed = await listIndexedRepositories(db, config, store);
    const fixture = listed.find((row) => row.repoId === "local/sample-java-project");
    expect(fixture?.nodeCount).toBe(38);
    expect(fixture?.commitSha).toBe(pointer.commitSha);
  });
});
