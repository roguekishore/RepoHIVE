/**
 * Indexed repository list from SQLite, with local
 * fixture pointers merged in local mode when the worker has not recorded them yet.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  latestKey,
  viewKey,
  VIEW_FILES,
  type ArtifactStore,
} from "@repohive/indexer";
import type { AppDatabase } from "@/lib/app-db/database";
import type { AppConfig } from "@/lib/hosting/config";
import { repoKeyToRepoId } from "./repo-display";

export const LOCAL_FIXTURE_NAMES = ["sample-java-project", "jsoup", "vantage", "BroadleafCommerce"] as const;

export const REPOSITORIES_PAGE_SIZE = 50;

export interface ListedRepository {
  readonly repoKey: string;
  readonly repoId: string;
  readonly snapshotId: string;
  readonly commitSha: string;
  readonly indexedAt: string;
  readonly nodeCount: number;
}

interface LatestPointerBody {
  readonly snapshotId?: string;
  readonly commitSha?: string;
  readonly publishedAt?: string;
}

interface HierarchyScaleBody {
  readonly totalNodes?: number;
}

function repoRootFromWebPackage(): string {
  return join(process.cwd(), "..", "..");
}

function presentLocalFixtures(): readonly string[] {
  const root = repoRootFromWebPackage();
  return LOCAL_FIXTURE_NAMES.filter((name) => existsSync(join(root, "fixtures", name)));
}

async function readLocalFixtureFromStore(
  store: ArtifactStore,
  fixtureName: string,
): Promise<ListedRepository | undefined> {
  const repoName = fixtureName.toLowerCase();
  const repoKey = `github.com/local/${repoName}`;
  const latestObject = await store.get(latestKey(repoKey));
  if (latestObject === undefined) {
    return undefined;
  }
  let pointer: LatestPointerBody;
  try {
    pointer = JSON.parse(new TextDecoder().decode(latestObject.body)) as LatestPointerBody;
  } catch {
    return undefined;
  }
  if (typeof pointer.snapshotId !== "string" || typeof pointer.commitSha !== "string") {
    return undefined;
  }
  const indexedAt =
    typeof pointer.publishedAt === "string" && pointer.publishedAt.length > 0
      ? pointer.publishedAt
      : new Date().toISOString();
  let nodeCount = 0;
  const scaleObject = await store.get(viewKey(pointer.snapshotId, VIEW_FILES.hierarchyScale));
  if (scaleObject !== undefined) {
    try {
      const scale = JSON.parse(new TextDecoder().decode(scaleObject.body)) as HierarchyScaleBody;
      if (typeof scale.totalNodes === "number" && scale.totalNodes >= 0) {
        nodeCount = scale.totalNodes;
      }
    } catch {
      // Leave node count at zero.
    }
  }
  return {
    repoKey,
    repoId: repoKeyToRepoId(repoKey),
    snapshotId: pointer.snapshotId,
    commitSha: pointer.commitSha,
    indexedAt,
    nodeCount,
  };
}

function readFromSqlite(db: AppDatabase): ListedRepository[] {
  const rows = db
    .prepare(
      `SELECT repo, snapshot_id, commit_sha, indexed_at, node_count
       FROM indexed_repositories
       ORDER BY indexed_at DESC`,
    )
    .all() as {
    repo: string;
    snapshot_id: string;
    commit_sha: string;
    indexed_at: string;
    node_count: number;
  }[];
  return rows.map((row) => ({
    repoKey: row.repo,
    repoId: repoKeyToRepoId(row.repo),
    snapshotId: row.snapshot_id,
    commitSha: row.commit_sha,
    indexedAt: row.indexed_at,
    nodeCount: row.node_count,
  }));
}

export async function listIndexedRepositories(
  db: AppDatabase,
  config: AppConfig,
  store: ArtifactStore,
): Promise<ListedRepository[]> {
  const byRepo = new Map<string, ListedRepository>();
  for (const row of readFromSqlite(db)) {
    byRepo.set(row.repoKey, row);
  }

  if (config.mode === "local") {
    for (const fixture of presentLocalFixtures()) {
      const repoKey = `github.com/local/${fixture.toLowerCase()}`;
      if (byRepo.has(repoKey)) {
        continue;
      }
      const fromStore = await readLocalFixtureFromStore(store, fixture);
      if (fromStore !== undefined) {
        byRepo.set(fromStore.repoKey, fromStore);
      }
    }
  }

  return [...byRepo.values()].sort((left, right) => right.indexedAt.localeCompare(left.indexedAt));
}

export function paginateRepositories(
  items: readonly ListedRepository[],
  page: number,
): { items: ListedRepository[]; page: number; totalPages: number; total: number } {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const total = items.length;
  const totalPages = total === 0 ? 1 : Math.ceil(total / REPOSITORIES_PAGE_SIZE);
  const clampedPage = Math.min(safePage, totalPages);
  const start = (clampedPage - 1) * REPOSITORIES_PAGE_SIZE;
  return {
    items: items.slice(start, start + REPOSITORIES_PAGE_SIZE),
    page: clampedPage,
    totalPages,
    total,
  };
}
