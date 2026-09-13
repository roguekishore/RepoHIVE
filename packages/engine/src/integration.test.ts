/**
 * Integration test: the real pipeline end-to-end over
 * `fixtures/sample-java-project`, with real parser, core, and filesystem.
 *
 * Run via `npm run test:integration --workspace @repohive/engine`. It is kept
 * out of the default unit run because the fixture is a git-ignored clone
 * target: a public clone does not have it. When the fixture is absent every
 * test here skips with an explicit message instead of failing, so the opt-in
 * run is still honest about what it did not check.
 *
 * The digest assertions compare against measurements recorded in
 * `docs/engineering/verification.md` (group digest confirmed 2026-08-22, parse
 * digest recorded 2026-08-16, both in the private development workspace). A
 * mismatch is signal — either a determinism regression or a legitimate output
 * change — and must be investigated, never recaptured silently.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { INDEX_FILE_NAMES } from "@repohive/core";

import { indexProject, type EngineProgressEvent } from "./index.js";

/** Root-relative fixture location; the compiled test runs from `dist/`. */
const FIXTURE = fileURLToPath(
  new URL("../../../fixtures/sample-java-project", import.meta.url),
);
const FIXTURE_PRESENT = existsSync(FIXTURE);
const SKIP_REASON =
  "fixtures/sample-java-project is absent (a git-ignored clone target); " +
  "clone it to run the integration suite";

/**
 * Recorded digests for this fixture (docs/engineering/verification.md):
 * - group: SHA-256 over the five index payloads, name + content in
 *   INDEX_FILE_NAMES order, exactly as core's demo-group-determinism computes
 *   it. Last confirmed 2026-08-22 (3 runs identical; 4 regions, 38 nodes,
 *   depth 4).
 * - parse: SHA-256 over the raw bytes of graph.json. Recorded 2026-08-16.
 */
const RECORDED_GROUP_DIGEST = "f30c7b3dfe38c476ada89a1175036cd36e1e623a08efc79345fd79beb3b4b5b3";
const RECORDED_PARSE_DIGEST = "a603b667abf1d7c903280a5ea661cae7087ecc90b9bafcfa9fbae25e7a6cccbc";

/** The demo-equivalent grouping digest: name + file bytes, in contract order. */
function indexDigest(indexDirectory: string): string {
  const hash = createHash("sha256");
  for (const name of INDEX_FILE_NAMES) {
    hash.update(name, "utf8");
    hash.update(readFileSync(join(indexDirectory, name)));
  }
  return hash.digest("hex");
}

function fileDigest(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

test("the real pipeline indexes the fixture and matches the recorded measurements", async (t) => {
  if (!FIXTURE_PRESENT) {
    t.skip(SKIP_REASON);
    return;
  }
  const outputDirectory = mkdtempSync(join(tmpdir(), "repohive-engine-it-"));
  try {
    const events: string[] = [];
    const result = await indexProject({
      projectDirectory: FIXTURE,
      outputDirectory,
      onProgress: (event: EngineProgressEvent) => {
        events.push(`${event.stage}:${event.kind}`);
      },
    });

    assert(result.ok, `expected success, got: ${JSON.stringify(result)}`);
    const value = result.value;

    // Layout: graph.json plus the five-file index contract, all present and
    // well-formed JSON.
    assert.equal(value.outputDirectory, outputDirectory);
    assert.equal(value.graphPath, join(outputDirectory, "graph.json"));
    assert.equal(value.indexDirectory, join(outputDirectory, "index"));
    assert(existsSync(value.graphPath), "graph.json must exist");
    for (const name of INDEX_FILE_NAMES) {
      const filePath = join(value.indexDirectory, name);
      assert(existsSync(filePath), `${name} must exist`);
      JSON.parse(readFileSync(filePath, "utf8"));
    }

    // The graph the result describes is the graph on disk.
    const graph = JSON.parse(readFileSync(value.graphPath, "utf8")) as {
      nodes: unknown[];
      edges: unknown[];
    };
    assert.equal(value.nodeCount, graph.nodes.length);
    assert.equal(value.edgeCount, graph.edges.length);

    // v1 semantics and timing invariants.
    assert.equal(value.parseSkipped, false);
    assert(value.durationMs.parse > 0);
    assert(value.durationMs.group > 0);
    assert(value.durationMs.total >= value.durationMs.parse + value.durationMs.group);
    assert.deepEqual(events, ["parse:start", "parse:complete", "group:start", "group:complete"]);

    // Recorded shape of this fixture's grouping (2026-08-22): 4 regions,
    // 38 hierarchy nodes, depth 4.
    assert.equal(value.regionCount, 4, "regionCount vs recorded 2026-08-22 measurement");
    assert.equal(value.hierarchyDepth, 4, "hierarchyDepth vs recorded 2026-08-22 measurement");
    const metadata = JSON.parse(
      readFileSync(join(value.indexDirectory, "metadata.json"), "utf8"),
    ) as { nodeCount: number };
    assert.equal(metadata.nodeCount, 38, "metadata.nodeCount vs recorded 2026-08-22 measurement");

    // Timing data must never reach an artifact: nothing under the output root
    // may contain the measured durations (spot check: no file mentions
    // durationMs, and re-runs below prove byte-stability).
    for (const name of INDEX_FILE_NAMES) {
      const text = readFileSync(join(value.indexDirectory, name), "utf8");
      assert(!text.includes("durationMs"), `${name} must not carry timing data`);
    }

    // Digest comparisons against the recorded measurements. A mismatch means
    // the fixture or the engine changed since 2026-08-22: investigate and
    // record; do not recapture silently.
    assert.equal(
      indexDigest(value.indexDirectory),
      RECORDED_GROUP_DIGEST,
      "group digest vs the recorded 2026-08-22 measurement",
    );
    assert.equal(
      fileDigest(value.graphPath),
      RECORDED_PARSE_DIGEST,
      "parse digest vs the recorded 2026-08-16 measurement",
    );
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("two runs over identical input produce byte-identical artifacts", async (t) => {
  if (!FIXTURE_PRESENT) {
    t.skip(SKIP_REASON);
    return;
  }
  const firstOut = mkdtempSync(join(tmpdir(), "repohive-engine-it1-"));
  const secondOut = mkdtempSync(join(tmpdir(), "repohive-engine-it2-"));
  try {
    const first = await indexProject({ projectDirectory: FIXTURE, outputDirectory: firstOut });
    const second = await indexProject({ projectDirectory: FIXTURE, outputDirectory: secondOut });
    assert(first.ok, `first run failed: ${JSON.stringify(first)}`);
    assert(second.ok, `second run failed: ${JSON.stringify(second)}`);

    const firstGraph = readFileSync(first.value.graphPath);
    const secondGraph = readFileSync(second.value.graphPath);
    assert(firstGraph.equals(secondGraph), "graph.json must be byte-identical across runs");

    for (const name of INDEX_FILE_NAMES) {
      const a = readFileSync(join(first.value.indexDirectory, name));
      const b = readFileSync(join(second.value.indexDirectory, name));
      assert(a.equals(b), `${name} must be byte-identical across runs`);
    }
  } finally {
    rmSync(firstOut, { recursive: true, force: true });
    rmSync(secondOut, { recursive: true, force: true });
  }
});
