/**
 * Each surface matches the recorded baselines on
 * Broadleaf and on sample-java-project, modulo the registry entry id swap.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createLocalArtifactStore, VIEW_FILES, viewKey, type ViewFile } from "@repohive/indexer";

const repoRoot = path.resolve(__dirname, "../../../../..");
const storeDir = path.join(repoRoot, ".repohive-local");
const baselineRoot = path.join(repoRoot, ".agents", "baselines", "hosting-3");

/** Registry entries from `capture-baselines.mjs`. */
const BASELINE_ENTRIES: Record<string, { id: string; name: string }> = {
  "sample-java-project": { id: "sample-java-project", name: "sample-java-project" },
  BroadleafCommerce: { id: "broadleaf", name: "broadleaf" },
};

const LOCAL_REPO: Record<string, string> = {
  "sample-java-project": "local/sample-java-project",
  BroadleafCommerce: "local/broadleafcommerce",
};

/** Surfaces not compared, per fixture. None today: entry-derived fields are normalized instead. */
const SKIP_ROUTES: Partial<Record<string, string[]>> = {};

/** Newest snapshot directory under `artifacts/<owner>/<repo>/`; the server's database pointer is not read here. */
function newestSnapshotId(repo: string): string | undefined {
  const dir = path.join(storeDir, "artifacts", repo);
  if (!existsSync(dir)) {
    return undefined;
  }
  const ids = readdirSync(dir).filter((name) => /^[0-9a-f]{32}$/.test(name));
  ids.sort((a, b) => statSync(path.join(dir, b)).mtimeMs - statSync(path.join(dir, a)).mtimeMs);
  return ids[0];
}

async function readView(
  store: ReturnType<typeof createLocalArtifactStore>,
  repo: string,
  snapshotId: string,
  file: string,
) {
  const object = await store.get(viewKey(`github.com/${repo}`, snapshotId, file as ViewFile));
  if (object === undefined) {
    return undefined;
  }
  const bytes = object.headers.contentEncoding === "br" ? brotliDecompressSync(object.body) : object.body;
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

/** Swap only registry entry fields, never Java package names that contain the repo name. */
function normalizeForBaseline(
  view: unknown,
  actualEntry: { id: string; name: string },
  baselineEntry: { id: string; name: string },
  route: string,
): unknown {
  if (view === null || typeof view !== "object") {
    return view;
  }
  const clone = structuredClone(view) as Record<string, unknown>;
  if (route === "repo.json") {
    clone.id = baselineEntry.id;
    clone.name = baselineEntry.name;
    return clone;
  }
  if (route === "zoom-map.json") {
    if (typeof clone.project_name === "string") {
      clone.project_name = baselineEntry.name;
    }
    if (Array.isArray(clone.nodes)) {
      // Only the root node is named after the entry. Other nodes may share the
      // name (Broadleaf has packages called `broadleafcommerce`) and stay as they are.
      clone.nodes = (clone.nodes as { id?: string; name?: string }[]).map((node) =>
        node.id === clone.root_id && node.name === actualEntry.name ? { ...node, name: baselineEntry.name } : node,
      );
    }
    return clone;
  }
  if (route === "adaptivity.json" && Array.isArray(clone.repos)) {
    clone.repos = (clone.repos as Record<string, unknown>[]).map((row) => ({
      ...row,
      id: baselineEntry.id,
      name: baselineEntry.name,
    }));
    return clone;
  }
  if (actualEntry.id !== baselineEntry.id || actualEntry.name !== baselineEntry.name) {
    return clone;
  }
  return clone;
}

async function compareFixture(fixture: string) {
  const baselineDir = path.join(baselineRoot, fixture);
  if (!existsSync(baselineDir)) {
    console.warn(`skipped: baseline missing for ${fixture}`);
    return;
  }
  if (!existsSync(storeDir)) {
    console.warn(`skipped: local store missing for ${fixture}`);
    return;
  }
  const store = createLocalArtifactStore(storeDir);
  const repo = LOCAL_REPO[fixture];
  if (repo === undefined) {
    throw new Error(`no local repo mapping for ${fixture}`);
  }
  const snapshotId = newestSnapshotId(repo);
  if (snapshotId === undefined) {
    console.warn(`skipped: ${repo} is not indexed`);
    return;
  }
  const baselineEntry = BASELINE_ENTRIES[fixture]!;
  const repoSegment = repo.slice("local/".length);
  const actualEntry = { id: repo, name: repoSegment };

  const routesDir = path.join(baselineDir, "routes");
  const skipped = new Set(SKIP_ROUTES[fixture] ?? []);
  for (const route of readdirSync(routesDir)) {
    if (route === "architecture" || route === "region-detail" || skipped.has(route)) {
      continue;
    }
    const baseline = JSON.parse(readFileSync(path.join(routesDir, route), "utf8"));
    const viewFile =
      route === "repo.json"
        ? VIEW_FILES.repo
        : route === "graph.json"
          ? VIEW_FILES.graph
          : route === "hierarchy-scale.json"
            ? VIEW_FILES.hierarchyScale
            : route === "region-decisions.json"
              ? VIEW_FILES.regionDecisions
              : route === "zoom-map.json"
                ? VIEW_FILES.zoomMap
                : route === "adaptivity.json"
                  ? VIEW_FILES.adaptivity
                  : route === "architecture.json"
                    ? VIEW_FILES.architecture
                    : undefined;
    if (viewFile === undefined) {
      continue;
    }
    const actual = await readView(store, repo, snapshotId, viewFile);
    expect(normalizeForBaseline(actual, actualEntry, baselineEntry, route), route).toEqual(baseline);
  }

  const meta = JSON.parse(readFileSync(path.join(baselineDir, "baseline.json"), "utf8")) as {
    architectureLevels: number[];
  };
  const archDir = path.join(routesDir, "architecture");
  if (existsSync(archDir)) {
    for (const file of readdirSync(archDir)) {
      const level = Number(/^level-(\d+)\.json$/.exec(file)?.[1]);
      if (Number.isNaN(level)) {
        continue;
      }
      const position = meta.architectureLevels.indexOf(level);
      expect(position, `architecture level ${level}`).toBeGreaterThanOrEqual(0);
      const baseline = JSON.parse(readFileSync(path.join(archDir, file), "utf8"));
      const actual = await readView(store, repo, snapshotId, `views/architecture/${position}.json`);
      expect(actual, file).toEqual(baseline);
    }
  }

  const regionDir = path.join(routesDir, "region-detail");
  if (existsSync(regionDir)) {
    const index = (await readView(store, repo, snapshotId, VIEW_FILES.regionDetailIndex)) as Record<string, number>;
    for (const file of readdirSync(regionDir)) {
      const baseline = JSON.parse(readFileSync(path.join(regionDir, file), "utf8")) as {
        regionId: string;
        status: number;
        body: unknown;
      };
      const position = index[baseline.regionId];
      const actual = await readView(store, repo, snapshotId, `views/region-detail/${position}.json`);
      if (baseline.status === 404) {
        expect(actual, file).toBeUndefined();
      } else {
        expect(actual, file).toEqual(baseline.body);
      }
    }
  }
}

describe("snapshot surfaces match the recorded baselines", () => {
  it("sample-java-project", async () => {
    await compareFixture("sample-java-project");
  });

  it("BroadleafCommerce", async () => {
    await compareFixture("BroadleafCommerce");
  }, 120_000);
});
