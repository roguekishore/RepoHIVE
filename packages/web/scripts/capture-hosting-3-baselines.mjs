/**
 * hosting-3 baselines (Order of work, step 1): records what today's `/api/*`
 * route handlers return, before phase C removes them, so Requirements 2.6 and
 * 4.3 can compare the snapshot path against it.
 *
 * It runs the engine on each fixture into a scratch directory, parses the
 * written index with `parseIndex` (what `index-loader.ts` does), and calls the
 * same `@repohive/views` builders each route handler calls, with the same
 * arguments. No server runs. Bodies are written with `JSON.stringify`, which is
 * what `NextResponse.json` sends.
 *
 *   node scripts/capture-hosting-3-baselines.mjs [fixture ...]
 *
 * Fixtures default to every present one of `sample-java-project` and
 * `BroadleafCommerce`. Output: `<repo root>/.agents/baselines/hosting-3/<fixture>/`
 * (git-ignored, never committed). Build the root first: this imports `dist/`.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseIndex } from "@repohive/core";
import { indexProject } from "@repohive/engine";
import {
  adaptHierarchyScale,
  adaptIndexToZoomMap,
  adaptRegionDetail,
  availableArchitectureLevels,
  buildAdaptivityView,
  buildArchitectureView,
  buildGraphView,
  buildRegionDecisionsView,
  buildRepoView,
  computeBlastRadius,
  countFiles,
} from "@repohive/views";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const outRoot = path.join(repoRoot, ".agents", "baselines", "hosting-3");

/** Today's registry entries (`repo-registry.ts`): id and name feed the repo view and the zoom map's root label. */
const FIXTURES = {
  "sample-java-project": { id: "sample-java-project", name: "sample-java-project" },
  BroadleafCommerce: { id: "broadleaf", name: "broadleaf" },
};

/** Blast-radius sample (Requirement 4.3): 100 nodes, fixed seed. */
const BLAST_RADIUS_SEED = 20261001;
const BLAST_RADIUS_SAMPLE = 100;

/** mulberry32: a small deterministic PRNG, so the sample is the same on every machine. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Byte-wise (UTF-16 code unit) order, independent of locale. */
function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `count` distinct ids from the sorted list, by a seeded partial Fisher-Yates shuffle. */
function sampleIds(ids, count, seed) {
  const pool = [...ids].sort(compareCodeUnits);
  const next = mulberry32(seed);
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i += 1) {
    const j = i + Math.floor(next() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

function write(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(body));
}

async function capture(fixture) {
  const entry = FIXTURES[fixture];
  const projectDirectory = path.join(repoRoot, "fixtures", fixture);
  if (!existsSync(projectDirectory)) {
    console.log(`${fixture}: not present, skipped`);
    return;
  }
  const out = path.join(outRoot, fixture);
  rmSync(out, { recursive: true, force: true });
  const runDirectory = path.join(out, "run");
  const run = await indexProject({ projectDirectory, outputDirectory: runDirectory });
  if (!run.ok) {
    throw new Error(`${fixture}: engine run failed: ${JSON.stringify(run.error)}`);
  }
  const parsed = parseIndex(path.join(runDirectory, "index"));
  if (!parsed.ok) {
    throw new Error(`${fixture}: parseIndex failed: ${JSON.stringify(parsed.error)}`);
  }
  const { hierarchy, metadata } = parsed.value;
  const routes = path.join(out, "routes");

  // GET /api/repos/{id}, /api/graph/{id}, /api/graph/{id}/hierarchy-scale, /region-decisions, /zoom-map.
  write(path.join(routes, "repo.json"), buildRepoView(entry));
  write(path.join(routes, "graph.json"), buildGraphView(hierarchy));
  write(path.join(routes, "hierarchy-scale.json"), adaptHierarchyScale(hierarchy, metadata));
  write(path.join(routes, "region-decisions.json"), buildRegionDecisionsView(hierarchy, metadata));
  write(path.join(routes, "zoom-map.json"), adaptIndexToZoomMap(hierarchy, metadata, entry.name));
  // GET /api/adaptivity, with this fixture as the only present repository.
  write(
    path.join(routes, "adaptivity.json"),
    buildAdaptivityView([{ id: entry.id, name: entry.name, metadata, files: countFiles(hierarchy) }], []),
  );
  // GET /api/graph/{id}/architecture, with no level and with every available level.
  write(path.join(routes, "architecture.json"), buildArchitectureView(hierarchy, metadata, undefined));
  const levels = availableArchitectureLevels(metadata).map((row) => row.level);
  for (const level of levels) {
    write(path.join(routes, "architecture", `level-${level}.json`), buildArchitectureView(hierarchy, metadata, level));
  }
  // GET /api/graph/{id}/region-detail?region=<id>, for every recorded region, in metadata order.
  const regionIds = metadata.regionDecisions.map((decision) => decision.regionId);
  regionIds.forEach((regionId, position) => {
    const detail = adaptRegionDetail(hierarchy, metadata, regionId);
    write(path.join(routes, "region-detail", `${position}.json`), { regionId, status: detail ? 200 : 404, body: detail });
  });
  // GET /api/graph/{id}/blast-radius?node=<id>, for the seeded sample.
  const nodes = sampleIds(hierarchy.nodes.keys(), BLAST_RADIUS_SAMPLE, BLAST_RADIUS_SEED);
  write(path.join(routes, "blast-radius.json"), {
    seed: BLAST_RADIUS_SEED,
    sample: nodes.length,
    results: nodes.map((node) => ({ node, result: computeBlastRadius(hierarchy, node) })),
  });

  write(path.join(out, "baseline.json"), {
    fixture,
    entry,
    nodes: hierarchy.nodes.size,
    regions: regionIds.length,
    architectureLevels: levels,
    blastRadius: { seed: BLAST_RADIUS_SEED, sample: nodes.length },
  });
  rmSync(runDirectory, { recursive: true, force: true });
  console.log(`${fixture}: ${hierarchy.nodes.size} nodes, ${regionIds.length} regions, levels ${levels.join(",")} -> ${out}`);
}

const requested = process.argv.slice(2);
const fixtures = requested.length > 0 ? requested : Object.keys(FIXTURES);
for (const fixture of fixtures) {
  if (!(fixture in FIXTURES)) {
    throw new Error(`unknown fixture ${fixture}; known: ${Object.keys(FIXTURES).join(", ")}`);
  }
  await capture(fixture);
}
