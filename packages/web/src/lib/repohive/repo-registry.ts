/**
 * RepoHIVE fixture repo registry — demo scaffolding for the local viewer.
 *
 * Maps a stable, human, URL-safe repo id to the fixture directory that holds
 * its `index/` set (the five-file Index_File_Set produced by the `group`
 * stage). This is the small "repo registry" the viewer protocol calls for
 * (§5): it lets the app boot to the one real surface (Knowledge Graph) without
 * a backend or a database.
 *
 * This is deliberately the only place that knows a repo id maps to a fixture
 * directory on disk. When a real store (hosted API / MCP / cloud DB) is wired
 * in later, only this mapping and the Index_Loader change — the endpoints and
 * the ZoomMap contract stay put.
 *
 * Server-only: `resolveIndexDir` reads `process.cwd()`. Do not import the
 * resolver into client components.
 */

import path from "node:path";

export interface RepoRegistryEntry {
  /** Stable, human, URL-safe id used in routes and as the RepoResponse id. */
  id: string;
  /** Display name (repository root label / project name in the ZoomMap). */
  name: string;
  /** Directory name under `fixtures/` holding this repo's `index/` set. */
  dir: string;
}

/**
 * The fixtures RepoHIVE's engine has already indexed. Ids are stable and
 * human so links and screenshots stay reproducible.
 */
export const REPO_REGISTRY: readonly RepoRegistryEntry[] = [
  { id: "vantage", name: "vantage", dir: "vantage" },
  { id: "broadleaf", name: "broadleaf", dir: "broadleaf" },
  { id: "sample-java-project", name: "sample-java-project", dir: "sample-java-project" },
] as const;

/** All registry entries, in canonical (declaration) order. */
export function listRegistryRepos(): readonly RepoRegistryEntry[] {
  return REPO_REGISTRY;
}

/** The entry for `id`, or `undefined` if the id is not registered. */
export function getRegistryRepo(id: string): RepoRegistryEntry | undefined {
  return REPO_REGISTRY.find((r) => r.id === id);
}

/**
 * Absolute path to a repo's `index/` directory on disk.
 *
 * Route handlers run with `process.cwd()` at the web package root
 * (`packages/web`), so the workspace root is two levels up and `fixtures/`
 * sits beside `packages/`. Kept in one place so the disk layout is a single
 * assumption, not a scattered one.
 */
export function resolveIndexDir(entry: RepoRegistryEntry): string {
  const workspaceRoot = path.resolve(process.cwd(), "..", "..");
  return path.join(workspaceRoot, "fixtures", entry.dir, "index");
}
