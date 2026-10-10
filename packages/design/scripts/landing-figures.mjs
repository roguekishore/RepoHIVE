#!/usr/bin/env node
/**
 * Builds the figures the landing page shows for BroadleafCommerce, from a real index. No figure on the page is typed by
 * hand: every number, every region score, the sunburst, the matrix, the map and the flat graph come out of this script,
 * and its output (`src/screens/landing/broadleaf-figures.ts`) is committed.
 *
 *   node packages/design/scripts/landing-figures.mjs <index-dir> [--out <file>] [--print-summary]
 *
 * `<index-dir>` is a directory holding the five index files (`repository.json`, `hierarchy.json`, `nodes.json`,
 * `edges.json`, `metadata.json`). A published index (brotli, as under `.repohive-local/store/idx/<hash>/`) is read as
 * it is: a file that does not start with `{` is brotli-decoded first.
 *
 * Needs `npm run build` at the repository root first: it reads the index with `@repohive/core` and takes the sunburst,
 * the matrix, the map, the decision list and the adaptivity counts from `@repohive/views`, the same code that builds
 * the views the app serves, so the landing and the app can never disagree about a figure.
 *
 * The only choices made here are selections, never values: the four regions the film follows (FEATURED, checked against
 * the index), which one in ten file dependencies the thumbnail of the flat graph draws, and the seeded layout of that
 * graph (seed 7). Identical input gives a byte-identical output file.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { groupIdOf, INDEX_FILE_NAMES, parseIndex } from "@repohive/core";
import { buildSnapshotViewsFromIndex } from "@repohive/views";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(HERE, "../src/screens/landing/broadleaf-figures.ts");

/** The regions the film follows: three that were kept and one that was rebuilt. Names only; every value is read. */
const FEATURED = {
  kept: ["core.catalog.domain", "core.order.domain", "cms.page.domain"],
  rebuilt: "common.util",
};
/** The package prefix every Broadleaf region name shares; the page shows names without it. */
const NAME_PREFIX = "org.broadleafcommerce.";
const LAYOUT_SEED = 7;
const FLAT_LINK_STRIDE = 10;

function fail(message) {
  console.error(`landing-figures: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { dir: undefined, out: DEFAULT_OUT, summary: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = resolve(argv[++i] ?? fail("--out needs a path"));
    else if (a === "--print-summary") args.summary = true;
    else if (a === "--help" || a === "-h") {
      console.log("usage: node packages/design/scripts/landing-figures.mjs <index-dir> [--out <file>] [--print-summary]");
      process.exit(0);
    } else if (a.startsWith("--")) fail(`unknown option ${a}`);
    else if (args.dir === undefined) args.dir = resolve(a);
    else fail("one index directory only");
  }
  if (args.dir === undefined) fail("give the index directory: node packages/design/scripts/landing-figures.mjs <index-dir>");
  return args;
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r6 = (x) => Number(x.toFixed(6));
const r5 = (x) => Number(x.toFixed(5));
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** The five files as plain bytes, whether the directory holds plain or brotli files. */
function readIndexBytes(dir) {
  const files = {};
  for (const name of INDEX_FILE_NAMES) {
    let bytes;
    try {
      bytes = readFileSync(join(dir, name));
    } catch {
      fail(`${name} is missing from ${dir}`);
    }
    if (bytes[0] !== 0x7b) bytes = brotliDecompressSync(bytes);
    files[name] = bytes;
  }
  return files;
}

/** Seeded force layout of the file graph, fitted to a 1000 by 1000 square (the thumbnail's own viewBox). */
function flatLayout(count, links) {
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  const dx = new Float64Array(count);
  const dy = new Float64Array(count);
  const rand = mulberry(LAYOUT_SEED);
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand());
    px[i] = Math.cos(a) * rr;
    py[i] = Math.sin(a) * rr;
  }
  const k = Math.sqrt(Math.PI / count);
  const k2 = k * k;
  const iterations = 150;
  for (let it = 0; it < iterations; it++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const ex = px[i] - px[j];
        const ey = py[i] - py[j];
        const f = k2 / (ex * ex + ey * ey + 1e-6);
        dx[i] += ex * f;
        dy[i] += ey * f;
        dx[j] -= ex * f;
        dy[j] -= ey * f;
      }
    }
    for (const [a, b] of links) {
      const fx = px[a] - px[b];
      const fy = py[a] - py[b];
      const g = (Math.sqrt(fx * fx + fy * fy) + 1e-6) / k;
      dx[a] -= fx * g;
      dy[a] -= fy * g;
      dx[b] += fx * g;
      dy[b] += fy * g;
    }
    const temp = 0.1 * (1 - it / iterations) + 0.002;
    for (let i = 0; i < count; i++) {
      dx[i] -= px[i] * 0.7;
      dy[i] -= py[i] * 0.7;
      const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) + 1e-9;
      const s = Math.min(len, temp) / len;
      px[i] += dx[i] * s;
      py[i] += dy[i] * s;
    }
  }
  let mx = 0;
  let my = 0;
  for (let i = 0; i < count; i++) {
    mx += px[i];
    my += py[i];
  }
  mx /= count;
  my /= count;
  const radii = [];
  for (let i = 0; i < count; i++) radii.push(Math.hypot(px[i] - mx, py[i] - my));
  radii.sort((a, b) => a - b);
  const scale = 470 / radii[Math.floor(count * 0.98)];
  const clamp = (v) => Math.max(0, Math.min(1000, Math.round(v)));
  const points = [];
  for (let i = 0; i < count; i++) points.push([clamp(500 + (px[i] - mx) * scale), clamp(500 + (py[i] - my) * scale)]);
  return points;
}

/**
 * The parser signal level the split was taken at: which of the three dependency signals (imports, method calls, shared
 * types) the index's file-level edges actually carry, and how many edges carry each. The split moves with this, so a
 * figure quoted without it is not a measurement of the codebase (measurements register, "Signal sensitivity").
 */
function signalLevel(counts) {
  const present = [];
  const absent = [];
  for (const [key, label] of [["imports", "imports"], ["calls", "method calls"], ["sharedTypes", "shared types"]]) {
    (counts[key] > 0 ? present : absent).push(label);
  }
  const join = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : (list[0] ?? "none"));
  return {
    imports: counts.imports,
    calls: counts.calls,
    sharedTypes: counts.sharedTypes,
    level: absent.length === 0 ? `${join(present)}` : `${join(present)}, with no ${join(absent)}`,
  };
}

const STATE_CODE = { none: 0, preserve: 1, reconstruct: 2, degenerate: 3 };

function build(dir) {
  const bytes = readIndexBytes(dir);
  const tmp = mkdtempSync(join(tmpdir(), "landing-figures-"));
  let parsed;
  try {
    for (const name of INDEX_FILE_NAMES) writeFileSync(join(tmp, name), bytes[name]);
    parsed = parseIndex(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (!parsed.ok) fail(`parseIndex refused the index: ${JSON.stringify(parsed.error).slice(0, 300)}`);
  const { hierarchy, metadata } = parsed.value;
  const views = buildSnapshotViewsFromIndex(parsed.value, { id: "broadleaf", name: "BroadleafCommerce" });

  // ---- counts --------------------------------------------------------------------------------------------------
  const adapt = views.adaptivity.repos[0];
  const kinds = { group: 0, file: 0, class: 0, function: 0, repository: 0 };
  for (const node of hierarchy.nodes.values()) kinds[node.kind] += 1;
  const leafEdges = hierarchy.leafEdges;
  const signal = { imports: 0, calls: 0, sharedTypes: 0 };
  for (const e of leafEdges) {
    if (e.importFrequency > 0) signal.imports += 1;
    if (e.methodCallFrequency > 0) signal.calls += 1;
    if (e.sharedTypeCount > 0) signal.sharedTypes += 1;
  }
  const config = metadata.configuration;
  const counts = {
    files: adapt.files,
    nodes: adapt.nodes,
    leafNodes: kinds.file + kinds.class + kinds.function,
    groupNodes: kinds.group,
    edges: adapt.edges,
    leafEdges: leafEdges.length,
    crossGroupEdges: hierarchy.crossGroupEdges.length,
    depth: adapt.depth,
    regions: adapt.regions,
    assessed: adapt.assessed,
    preserved: adapt.preserved,
    reconstructed: adapt.reconstructed,
    degenerate: adapt.degenerate,
    preserveShare: r6(adapt.preserveShare),
  };
  if (counts.assessed !== counts.preserved + counts.reconstructed) fail("assessed is not preserved plus reconstructed");
  if (counts.regions !== counts.assessed + counts.degenerate) fail("regions is not assessed plus degenerate");
  if (counts.edges !== counts.leafEdges + counts.crossGroupEdges) fail("edges is not leaf plus cross-group edges");

  const settings = {
    boundary: config.structuralQualityBoundary,
    cohesionWeight: metadata.metricWeights.cohesion,
    couplingWeight: metadata.metricWeights.coupling,
    squash: metadata.cohesionSquashConstant,
    seed: config.communityDetectionSeed,
    maxGroupSize: config.hierarchy.maxGroupSize,
    importCoefficient: config.weightCoefficients.importCoefficient,
    callCoefficient: config.weightCoefficients.callCoefficient,
    sharedTypeCoefficient: config.weightCoefficients.sharedTypeCoefficient,
  };

  // ---- the measured regions: one row each, with the recorded decision --------------------------------------------
  const strip = (name) => (name.startsWith(NAME_PREFIX) ? name.slice(NAME_PREFIX.length) : name);
  const decisions = views.regionDecisions.regions;
  const regions = [];
  for (const d of decisions) {
    if (d.score === 0 && d.cohesion === 0) continue; // unassessed (see the measurements register)
    const dec = d.action === "preserve" ? 1 : 2;
    // The what-if on the page is arithmetic on these scores, so at the recorded boundary it must reproduce the record.
    if ((r6(d.score) >= settings.boundary ? 1 : 2) !== dec) fail(`region ${d.displayName}: its score and its recorded action disagree at the boundary`);
    regions.push([strip(d.displayName), d.fileCount, r6(d.cohesion), r6(d.coupling), r6(d.score), dec, d.groupIds.length]);
  }
  if (regions.length !== counts.assessed) fail(`found ${regions.length} assessed regions, the adaptivity view says ${counts.assessed}`);
  if (regions.filter((r) => r[5] === 1).length !== counts.preserved) fail("kept count differs from the adaptivity view");

  const byName = new Map(regions.map((r) => [r[0], r]));
  const featured = { kept: [], rebuilt: null };
  for (const name of FEATURED.kept) {
    const row = byName.get(name) ?? fail(`featured region ${name} is not among the measured regions`);
    if (row[5] !== 1) fail(`featured region ${name} was not kept`);
    featured.kept.push(name);
  }
  const rb = byName.get(FEATURED.rebuilt) ?? fail(`featured region ${FEATURED.rebuilt} is not among the measured regions`);
  if (rb[5] !== 2) fail(`featured region ${FEATURED.rebuilt} was not rebuilt`);
  featured.rebuilt = FEATURED.rebuilt;

  // The rebuilt region's four largest groups, for the film's zoom: id, file count, and the first file's name.
  const rebuiltDecision = decisions.find((d) => strip(d.displayName) === FEATURED.rebuilt);
  const filesUnder = (id) => {
    const out = [];
    const stack = [id];
    while (stack.length > 0) {
      const node = hierarchy.nodes.get(stack.pop());
      if (node.kind === "file") out.push(node.id);
      else for (let i = node.childIds.length - 1; i >= 0; i--) stack.push(node.childIds[i]);
    }
    return out;
  };
  const zoomGroups = rebuiltDecision.groupIds
    .map((id) => ({ id, files: filesUnder(id) }))
    .filter((g) => g.files.length >= 3)
    .sort((a, b) => b.files.length - a.files.length || (a.id < b.id ? -1 : 1))
    .slice(0, 4)
    .map((g) => ({
      id: g.id.slice(0, 10),
      files: g.files.length,
      sample: g.files[Math.min(4, g.files.length - 1)].split("/").pop(),
    }));
  if (zoomGroups.length < 4) fail("the rebuilt featured region has fewer than four groups of three or more files");

  // ---- sunburst, matrix, map, flat graph --------------------------------------------------------------------------
  const hs = views.hierarchyScale;
  const arcs = hs.arcs.map((a) => [a.level, r5(a.start), r5(a.span), a.files, STATE_CODE[a.state]]);
  const dsmView = views.architecture.dsm;
  const dsm = {
    n: dsmView.groups.length,
    max: dsmView.maxWeight,
    entries: dsmView.entries.map((e) => [e.from, e.to, e.weight]),
    blocks: dsmView.blocks.map((b) => [b.start, b.size, STATE_CODE[b.state]]),
    level: dsmView.level,
    totalGroups: dsmView.totalGroups,
    omittedGroups: dsmView.omittedGroups,
  };
  const degenerateRegions = new Set(decisions.filter((d) => d.score === 0 && d.cohesion === 0).map((d) => d.regionId));
  // Breadth first from the repository, siblings by their recorded rank, so a parent always precedes its children.
  const mapSource = views.zoomMap.nodes.filter((n) => n.kind !== "file" && n.level <= 3);
  const mapById = new Map(mapSource.map((n) => [n.id, n]));
  const childrenOf = new Map();
  let mapRoot;
  for (const n of mapSource) {
    if (n.parent_id === null) mapRoot = n;
    else (childrenOf.get(n.parent_id) ?? childrenOf.set(n.parent_id, []).get(n.parent_id)).push(n);
  }
  if (mapRoot === undefined) fail("the zoom map has no root");
  const mapNodes = [mapRoot];
  for (let i = 0; i < mapNodes.length; i++) {
    const kids = (childrenOf.get(mapNodes[i].id) ?? []).sort((a, b) => a.sibling_rank - b.sibling_rank || (a.id < b.id ? -1 : 1));
    mapNodes.push(...kids);
  }
  if (mapNodes.length !== mapById.size) fail("some map nodes are not reachable from the root");
  const mapIndex = new Map(mapNodes.map((n, i) => [n.id, i]));
  const map = mapNodes.map((n) => {
    const regionId = hierarchy.nodes.get(n.id)?.regionId;
    const dec = n.decision === "preserve" ? 1 : n.decision === "reconstruct" ? (degenerateRegions.has(regionId) ? 3 : 2) : 0;
    return [n.parent_id === null ? -1 : mapIndex.get(n.parent_id), n.importance, n.sibling_rank, dec];
  });

  const graph = views.graph;
  const fileIndex = new Map(graph.nodes.map((n, i) => [n.node_id, i]));
  const links = [];
  for (const l of graph.links) {
    const a = fileIndex.get(l.source);
    const b = fileIndex.get(l.target);
    if (a !== undefined && b !== undefined && a !== b) links.push([a, b]);
  }
  const flatPoints = flatLayout(graph.nodes.length, links);
  const flatLinks = [];
  links.forEach((l, i) => {
    if (i % FLAT_LINK_STRIDE === 0) flatLinks.push(l[0], l[1]);
  });

  // ---- determinism ------------------------------------------------------------------------------------------------
  // The `group` digest of the determinism gate: SHA-256 over each index file's name, then its content without the
  // trailing newline, in contract order (`docs/engineering/verification.md`, Gate 3).
  const digest = createHash("sha256");
  const indexFiles = [];
  for (const name of INDEX_FILE_NAMES) {
    const text = bytes[name];
    const body = text[text.length - 1] === 0x0a ? text.subarray(0, text.length - 1) : text;
    digest.update(name, "utf8");
    digest.update(body);
    indexFiles.push({ name, bytes: text.length, sha256: sha256(text) });
  }
  let sample;
  for (const node of [...hierarchy.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (node.kind === "group" && node.childIds.length === settings.maxGroupSize) {
      if (groupIdOf(node.childIds) !== node.id) fail("a group id does not equal sha1 of its sorted member ids");
      sample = { id: node.id, members: node.childIds.length };
      break;
    }
  }
  if (sample === undefined) fail("no group with a full set of members to use as the example");

  return {
    repository: "BroadleafCommerce",
    indexFormatVersion: 1,
    namePrefix: NAME_PREFIX,
    counts,
    signal: signalLevel(signal),
    settings,
    regions,
    featured,
    zoom: { region: FEATURED.rebuilt, groups: zoomGroups },
    arcs,
    dsm,
    map,
    flat: { points: flatPoints, links: flatLinks, stride: FLAT_LINK_STRIDE, totalLinks: links.length, seed: LAYOUT_SEED },
    determinism: {
      groupScheme: "g_<sha1( json(sorted member ids) )>",
      sampleGroupId: sample.id,
      sampleMembers: sample.members,
      digest: digest.digest("hex"),
      files: indexFiles,
    },
  };
}

function render(figures) {
  const lines = [];
  lines.push("/*");
  lines.push(" * GENERATED by packages/design/scripts/landing-figures.mjs from a real BroadleafCommerce index. Do not edit by hand:");
  lines.push(" * rerun the script (see its header). Rows are documented in ./figures-types.ts.");
  lines.push(" */");
  lines.push('import type { LandingFigures } from "./figures-types";');
  lines.push("");
  lines.push("export const BROADLEAF_FIGURES: LandingFigures = {");
  for (const [key, value] of Object.entries(figures)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value) && key === "flat") {
      lines.push(`  flat: {`);
      for (const [k, v] of Object.entries(value)) lines.push(`    ${k}: ${JSON.stringify(v)},`);
      lines.push("  },");
    } else if (key === "dsm") {
      lines.push(`  dsm: {`);
      for (const [k, v] of Object.entries(value)) lines.push(`    ${k}: ${JSON.stringify(v)},`);
      lines.push("  },");
    } else lines.push(`  ${key}: ${JSON.stringify(value)},`);
  }
  lines.push("};");
  lines.push("");
  return lines.join("\n");
}

const args = parseArgs(process.argv.slice(2));
const figures = build(args.dir);
writeFileSync(args.out, render(figures));
if (args.summary) {
  const c = figures.counts;
  console.log(`BroadleafCommerce: ${c.files} files, ${c.nodes} nodes (${c.leafNodes} leaves + ${c.groupNodes} groups), ${c.edges} edges (${c.leafEdges} file-level + ${c.crossGroupEdges} between groups)`);
  console.log(`regions ${c.regions}: ${c.assessed} assessed (${c.preserved} kept, ${c.reconstructed} rebuilt), ${c.degenerate} unassessed`);
  console.log(`parser signal: ${figures.signal.level}; edges with imports ${figures.signal.imports}, calls ${figures.signal.calls}, shared types ${figures.signal.sharedTypes}`);
  console.log(`index digest ${figures.determinism.digest}`);
  for (const f of figures.determinism.files) console.log(`  ${f.name} ${f.bytes} B ${f.sha256}`);
}
console.log(`wrote ${args.out}`);
