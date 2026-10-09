/**
 * Local-mode fixture tarballs and a GitHub API stand-in:
 * the intake pre-check and the local orchestrator child read the same archives the
 * seed command uses, with no network calls.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FetchFunction, FetchRequest } from "@repohive/indexer";
import { DEFAULT_FETCH_CAPS, readTarGz } from "@repohive/indexer";

/** Fixture directory name under `fixtures/` for each `local/<repo>` segment (lowercase). */
export const LOCAL_REPO_TO_FIXTURE: Readonly<Record<string, string>> = {
  "sample-java-project": "sample-java-project",
  broadleafcommerce: "BroadleafCommerce",
  jsoup: "jsoup",
  vantage: "vantage",
};

const webPackageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const repoRoot = path.resolve(webPackageRoot, "..", "..");

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** The commit and tree-ish to archive, or `undefined` when the fixture is in no repository. */
export function fixtureSource(fixture: string): { cwd: string; commitSha: string; treeish: string } | undefined {
  const directory = path.join(repoRoot, "fixtures", fixture);
  if (existsSync(path.join(directory, ".git"))) {
    return { cwd: directory, commitSha: git(["rev-parse", "HEAD"], directory), treeish: "HEAD" };
  }
  const commitSha = git(["log", "-1", "--format=%H", "--", `fixtures/${fixture}`], repoRoot);
  if (commitSha === "") {
    return undefined;
  }
  return { cwd: repoRoot, commitSha, treeish: `${commitSha}:fixtures/${fixture}` };
}

/** Maps `github.com/local/<name>` to a fixture directory name, if any. */
export function fixtureForLocalRepo(localRepoSegment: string): string | undefined {
  return LOCAL_REPO_TO_FIXTURE[localRepoSegment.toLowerCase()];
}

/** Builds or reuses a cached `git archive` tarball for a fixture; returns its path. */
export function ensureFixtureTarball(fixture: string, cacheDirectory: string): { tarballPath: string; commitSha: string } {
  const source = fixtureSource(fixture);
  if (source === undefined) {
    throw new Error(`fixture ${fixture} is not in a git repository`);
  }
  mkdirSync(cacheDirectory, { recursive: true });
  const repoName = fixture.toLowerCase();
  const tarballPath = path.join(cacheDirectory, `${repoName}-${source.commitSha.slice(0, 12)}.tar.gz`);
  if (!existsSync(tarballPath)) {
    const scratch = mkdtempSync(path.join(tmpdir(), "repohive-tarball-"));
    try {
      const out = path.join(scratch, "archive.tar.gz");
      git(
        [
          "archive",
          "--format=tar.gz",
          `--prefix=local-${repoName}-${source.commitSha}/`,
          "-o",
          out,
          source.treeish,
        ],
        source.cwd,
      );
      copyFileSync(out, tarballPath);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  return { tarballPath, commitSha: source.commitSha };
}

async function listJavaEntries(tarballPath: string): Promise<{ path: string; bytes: Uint8Array }[]> {
  const request: FetchRequest = {
    owner: "local",
    repo: "listing",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    tier: "XL",
  };
  const result = await readTarGz(async () => createReadStream(tarballPath), request, DEFAULT_FETCH_CAPS);
  if (!result.ok) {
    throw new Error(`could not read fixture tarball: ${JSON.stringify(result)}`);
  }
  return [...result.source.entries];
}

function stubFromTarball(entries: { path: string; bytes: Uint8Array }[], commitSha: string): FetchFunction {
  return async (url) => {
    const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });
    if (url.includes("/git/trees/")) {
      return json({
        sha: commitSha,
        truncated: false,
        tree: entries.map((entry) => ({ path: entry.path, type: "blob", size: entry.bytes.byteLength })),
      });
    }
    if (url.includes("/commits/")) {
      return json({ sha: commitSha });
    }
    return json({ private: false, archived: false, default_branch: "main" });
  };
}

let tarballCache: Map<string, { tarballPath: string; commitSha: string; stub: FetchFunction }> = new Map();

/** Pre-build stubs for the fixtures that will be requested (call once at process start). */
export async function warmLocalFixtureCache(
  fixtures: readonly string[],
  cacheDirectory: string,
): Promise<void> {
  for (const fixture of fixtures) {
    if (tarballCache.has(fixture)) {
      continue;
    }
    const { tarballPath, commitSha } = ensureFixtureTarball(fixture, cacheDirectory);
    const entries = await listJavaEntries(tarballPath);
    tarballCache.set(fixture, { tarballPath, commitSha, stub: stubFromTarball(entries, commitSha) });
  }
}

export function resetLocalFixtureCacheForTests(): void {
  tarballCache = new Map();
}

/** Tarball path for a canonical repo key `github.com/local/<name>`. */
export function tarballForRepoKey(repoKey: string, cacheDirectory: string): string {
  const match = /^github\.com\/local\/([^/]+)$/.exec(repoKey);
  if (match === null) {
    throw new RangeError(`not a local fixture repo key: ${repoKey}`);
  }
  const fixture = fixtureForLocalRepo(match[1]!);
  if (fixture === undefined) {
    throw new RangeError(`no fixture for local repo ${match[1]}`);
  }
  const cached = tarballCache.get(fixture);
  if (cached !== undefined) {
    return cached.tarballPath;
  }
  return ensureFixtureTarball(fixture, cacheDirectory).tarballPath;
}

/**
 * GitHub `fetch` stand-in for local fixtures. Non-local URLs fall through to the
 * global `fetch` (which should not run in local e2e).
 */
export function createLocalPrecheckFetch(cacheDirectory: string): FetchFunction {
  return async (url, init) => {
    const match = /api\.github\.com\/repos\/([^/]+)\/([^/?#]+)/.exec(url);
    if (match === null) {
      return fetch(url, init);
    }
    const owner = match[1]!.toLowerCase();
    const repo = match[2]!.toLowerCase();
    if (owner !== "local") {
      return fetch(url, init);
    }
    const fixture = fixtureForLocalRepo(repo);
    if (fixture === undefined) {
      return new Response("", { status: 404 });
    }
    if (!tarballCache.has(fixture)) {
      await warmLocalFixtureCache([fixture], cacheDirectory);
    }
    const cached = tarballCache.get(fixture)!;
    return cached.stub(url, init);
  };
}
