/**
 * End-to-end integration tests over the full grouping seam: a hand-written,
 * contract-conforming RawDependencyGraph (the documented "safety valve"
 * shape — one healthy package that stays preserved, one cross-package tangle
 * that gets reconstructed, one degenerate singleton) pushed through
 * groupGraph, the serialize→parse round trip, and the blast-radius analyzer;
 * plus the checked-in sample-java-project fixture when present.
 *
 * Example-based by design — the property layer lives in the sibling *.test.ts
 * files.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RawDependencyGraph } from "@repohive/shared";
import { analyzeBlastRadius } from "./blast-radius.js";
import { decideAction } from "./constructor.js";
import { parseIndex } from "./index-parser.js";
import { serializeIndex } from "./index-serializer.js";
import { groupGraph, type GroupingOutput } from "./orchestrator.js";

// --- The safety-valve fixture ------------------------------------------------
// Three Java packages, 8 files, 2 class nodes:
// - com.acme.core: well connected (3 intra-package import edges, strong
//   signals) → cohesion high, coupling low → preserved under the 0.5 boundary;
// - com.acme.app: a tangle — almost every edge leaves the package → low score
//   → reconstructed;
// - com.acme.util: a singleton package → degenerate (score 0) → reconstructed.

const CORE_DIR = "src/com/acme/core";
const APP_DIR = "src/com/acme/app";
const UTIL_DIR = "src/com/acme/util";

const ENGINE = "file:src/com/acme/core/Engine.java";
const PIPELINE = "file:src/com/acme/core/Pipeline.java";
const SCHEDULER = "file:src/com/acme/core/Scheduler.java";
const MAIN = "file:src/com/acme/app/Main.java";
const CONTROLLER = "file:src/com/acme/app/Controller.java";
const HANDLER = "file:src/com/acme/app/Handler.java";
const VIEW = "file:src/com/acme/app/View.java";
const STRINGS = "file:src/com/acme/util/Strings.java";

const FILE_IDS = [ENGINE, PIPELINE, SCHEDULER, MAIN, CONTROLLER, HANDLER, VIEW, STRINGS];

const MAIN_CLASS = "class:com.acme.app.Main";
const ENGINE_CLASS = "class:com.acme.core.Engine";

const SAFETY_VALVE_GRAPH: RawDependencyGraph = {
  nodes: [
    { id: ENGINE, kind: "file", packagePath: "com.acme.core", directoryPath: CORE_DIR },
    { id: PIPELINE, kind: "file", packagePath: "com.acme.core", directoryPath: CORE_DIR },
    { id: SCHEDULER, kind: "file", packagePath: "com.acme.core", directoryPath: CORE_DIR },
    { id: MAIN, kind: "file", packagePath: "com.acme.app", directoryPath: APP_DIR },
    { id: CONTROLLER, kind: "file", packagePath: "com.acme.app", directoryPath: APP_DIR },
    { id: HANDLER, kind: "file", packagePath: "com.acme.app", directoryPath: APP_DIR },
    { id: VIEW, kind: "file", packagePath: "com.acme.app", directoryPath: APP_DIR },
    { id: STRINGS, kind: "file", packagePath: "com.acme.util", directoryPath: UTIL_DIR },
    {
      id: ENGINE_CLASS,
      kind: "class",
      packagePath: "com.acme.core",
      directoryPath: CORE_DIR,
      definedInFile: ENGINE,
    },
    {
      id: MAIN_CLASS,
      kind: "class",
      packagePath: "com.acme.app",
      directoryPath: APP_DIR,
      definedInFile: MAIN,
    },
  ],
  edges: [
    // The well-connected core: 3 intra-package import edges, strong signals.
    { source: PIPELINE, target: ENGINE, importFrequency: 3, methodCallFrequency: 2, sharedTypeCount: 1 },
    { source: SCHEDULER, target: ENGINE, importFrequency: 2, methodCallFrequency: 1, sharedTypeCount: 0 },
    { source: SCHEDULER, target: PIPELINE, importFrequency: 2, methodCallFrequency: 0, sharedTypeCount: 1 },
    // The app tangle: nearly everything crosses a package boundary.
    { source: MAIN, target: ENGINE, importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0 },
    { source: HANDLER, target: ENGINE, importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0 },
    { source: MAIN, target: CONTROLLER, importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0 },
    { source: CONTROLLER, target: STRINGS, importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0 },
    { source: VIEW, target: STRINGS, importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0 },
    // A class-level edge; attributed to Main.java → Engine.java at file grain.
    { source: MAIN_CLASS, target: ENGINE_CLASS, importFrequency: 0, methodCallFrequency: 2, sharedTypeCount: 0 },
  ],
};

const EXPECTED_REGIONS = ["pkg:com.acme.app", "pkg:com.acme.core", "pkg:com.acme.util"];

function groupSafetyValve(): GroupingOutput {
  const result = groupGraph(SAFETY_VALVE_GRAPH);
  assert.ok(result.ok, "the safety-valve fixture must group under the default config");
  return result.value;
}

test("groupGraph on the safety-valve fixture places every file exactly once (R6, R4.5)", () => {
  const { hierarchy } = groupSafetyValve();

  // Every input file id appears exactly once as a file-kind hierarchy node.
  const fileNodes = [...hierarchy.nodes.values()].filter((node) => node.kind === "file");
  assert.equal(fileNodes.length, FILE_IDS.length);
  assert.deepEqual(new Set(fileNodes.map((node) => node.id)), new Set(FILE_IDS));

  // Class leaves hang under their defining file.
  assert.equal(hierarchy.nodes.get(MAIN_CLASS)?.kind, "class");
  assert.equal(hierarchy.nodes.get(MAIN_CLASS)?.parentId, MAIN);
  assert.equal(hierarchy.nodes.get(ENGINE_CLASS)?.parentId, ENGINE);

  // Repository root exists and the tree has real depth.
  assert.equal(hierarchy.nodes.get(hierarchy.repositoryId)?.level, 0);
  assert.ok(hierarchy.depth >= 3, "repository → region group → construction group → file");
});

test("metadata records one decision per package region against the 0.5 boundary (R5)", () => {
  const { metadata } = groupSafetyValve();

  assert.equal(metadata.structuralQualityBoundary, 0.5);

  // Exactly one decision per package Region.
  const regionIds = metadata.regionDecisions.map((decision) => decision.regionId).sort();
  assert.deepEqual(regionIds, EXPECTED_REGIONS);

  for (const decision of metadata.regionDecisions) {
    assert.ok(decision.score >= 0 && decision.score <= 1);
    assert.equal(decision.action, decideAction(decision.score, 0.5), "no overrides → automatic decision applies");
    assert.equal(decision.automaticAction, decision.action);
    assert.equal(decision.userOverridden, false);
    assert.ok(Math.abs(decision.decisionConfidence - Math.abs(decision.score - 0.5)) < 1e-12);
  }

  // The safety valve: healthy core preserved, tangle and singleton rebuilt.
  const byRegion = new Map(metadata.regionDecisions.map((decision) => [decision.regionId, decision]));
  assert.equal(byRegion.get("pkg:com.acme.core")?.action, "preserve");
  assert.ok(byRegion.get("pkg:com.acme.core")!.score > 0.5);
  assert.equal(byRegion.get("pkg:com.acme.app")?.action, "reconstruct");
  assert.equal(byRegion.get("pkg:com.acme.util")?.action, "reconstruct");
  assert.equal(byRegion.get("pkg:com.acme.util")?.score, 0, "singleton region is degenerate");

  // Default metric weights are recorded and renormalize to a sum of ≈ 1
  // (cohesion's renormalized share is 0.5 under the defaults).
  const { metricWeights } = metadata;
  assert.equal(typeof metricWeights.cohesion, "number");
  assert.equal(typeof metricWeights.coupling, "number");
  const total = metricWeights.cohesion + metricWeights.coupling + (metricWeights.modularity ?? 0);
  assert.ok(total > 0);
  const shares = [
    metricWeights.cohesion / total,
    metricWeights.coupling / total,
    (metricWeights.modularity ?? 0) / total,
  ];
  assert.ok(Math.abs(shares.reduce((sum, share) => sum + share, 0) - 1) < 1e-12);
  assert.ok(Math.abs(shares[0]! - 0.5) < 1e-12, "default cohesion weight renormalizes to 0.5");
  assert.equal(typeof metadata.cohesionSquashConstant, "number");
});

test("serialize → parseIndex round trip preserves ids, depth, and decisions (R9.5)", () => {
  const { hierarchy, metadata } = groupSafetyValve();

  const dir = mkdtempSync(join(tmpdir(), "repohive-e2e-index-"));
  try {
    const written = serializeIndex(hierarchy, metadata, dir);
    assert.ok(written.ok, "index must serialize");

    const parsed = parseIndex(dir);
    assert.ok(parsed.ok, "a just-written index must parse");

    assert.deepEqual(new Set(parsed.value.hierarchy.nodes.keys()), new Set(hierarchy.nodes.keys()));
    assert.equal(parsed.value.hierarchy.depth, hierarchy.depth);
    assert.deepEqual(parsed.value.metadata.regionDecisions, metadata.regionDecisions);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("blast radius of the file everyone imports reaches all its dependents (R10)", () => {
  const { hierarchy } = groupSafetyValve();

  const radius = analyzeBlastRadius(hierarchy, ENGINE);
  assert.ok(radius.ok);
  assert.ok(radius.value.nodes.length > 1, "a widely-imported file must impact more than itself");
  // Exactly the target plus everything that transitively depends on it.
  assert.deepEqual(new Set(radius.value.nodes), new Set([ENGINE, PIPELINE, SCHEDULER, MAIN, HANDLER]));
  assert.ok(radius.value.groupNodes.length > 0, "impacted leaves surface their containing groups");
});

test("the checked-in sample-java-project fixture groups with every input node as a leaf", () => {
  const fixturePath = findSampleFixture();
  if (fixturePath === null) {
    return; // Fixture not present in this checkout; nothing to verify.
  }

  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as RawDependencyGraph;
  assert.equal(raw.nodes.length, 29);
  // Edge count updated after Wave A (Gap 1a + 1c) re-parse: type-use edges and
  // same-package resolution now produce 6 edges instead of 5 (one additional
  // intra-package edge discovered via sharedTypeCount).
  assert.equal(raw.edges.length, 6);

  const result = groupGraph(raw);
  assert.ok(result.ok, "the parser fixture must group under the default config");

  const leafKinds = new Set(["file", "class", "function"]);
  const leafIds = [...result.value.hierarchy.nodes.values()]
    .filter((node) => leafKinds.has(node.kind))
    .map((node) => node.id);
  assert.equal(leafIds.length, 29);
  assert.deepEqual(new Set(leafIds), new Set(raw.nodes.map((node) => node.id)));
});

/** Walk up from this module (works from src/ and from compiled dist/). */
function findSampleFixture(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "fixtures", "sample-java-project", "graph.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    dir = dirname(dir);
  }
  return null;
}
