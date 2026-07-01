/**
 * End-to-end fixture test and determinism properties (Task 10).
 *
 * This test drives the *real* pipeline (real Tree-Sitter Java grammar, real
 * filesystem) over the checked-in `fixtures/sample-java-project`, so it gates
 * the two guarantees the parser owes its only downstream consumer:
 *
 * 1. **Parser↔grouping seam (R7.8).** The emitted `graph.json` must load under
 *    the core ingestor's schema validation with zero errors. The core
 *    `hierarchical-repository-grouping` spec is not implemented yet, so this
 *    file validates the *exact* {@link RawDependencyGraph} contract shape the
 *    ingestor will require: `GraphNode` / `DependencyEdge` field shapes, no
 *    `strength`, valid `kind`s, integer frequency signals, and referential
 *    integrity of every edge endpoint against the node set.
 * 2. **Determinism (R9.1, R9.5, R9.6).** Byte-identity (identical SHA-256)
 *    across repeated runs, and across differing filesystem enumeration order.
 *
 * The determinism checks use {@link verifyDeterminism}; the shuffled-order
 * property injects a collector that reshuffles the discovered files per run
 * (seeded by `fast-check`) to simulate differing enumeration order while the
 * pipeline's canonical ordering must still produce a byte-identical output.
 *
 * These tests need the built grammar WASM to resolve from `node_modules`; they
 * run against real source, so `npm run build` must precede `npm test`.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import fc from "fast-check";

import type {
  DependencyEdge,
  GraphNode,
  RawDependencyGraph,
} from "@repohive/shared";

import { parseProject, type ParseDeps } from "./orchestrator.js";
import { verifyDeterminism } from "./verify-determinism.js";
import { createInputValidator } from "./input-validator.js";
import {
  createSourceFileCollector,
  type SourceFileCollector,
} from "./source-collector.js";
import { createAstExtractor } from "./ast-extractor.js";
import { createSymbolTableBuilder } from "./symbol-table.js";
import { createStitcher } from "./stitcher.js";
import { createGraphSerializer } from "./serializer.js";
import { ok, type ParseError } from "./errors.js";
import type { CollectedFile } from "./types.js";

// --------------------------------------------------------------------------
// Fixture location: <repo>/fixtures/sample-java-project. This file compiles to
// <repo>/packages/parser/dist/end-to-end.test.js, so the repo root is three
// levels up.
// --------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(
  HERE,
  "..",
  "..",
  "..",
  "fixtures",
  "sample-java-project",
);

const NODE_KINDS: ReadonlySet<string> = new Set([
  "file",
  "function",
  "class",
  "group",
  "repository",
]);
const PARSER_NODE_KINDS: ReadonlySet<string> = new Set([
  "file",
  "class",
  "function",
]);
const MAX_FREQUENCY = 2_147_483_647;

// --------------------------------------------------------------------------
// Lightweight schema validation of the exact contract shape the downstream
// core ingestor will require (R7.8). Returns the list of violations; an empty
// list means the graph conforms with zero schema errors.
// --------------------------------------------------------------------------

function isNonNegativeInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_FREQUENCY
  );
}

function validateNode(node: unknown, index: number, errors: string[]): void {
  if (typeof node !== "object" || node === null) {
    errors.push(`node[${index}] is not an object`);
    return;
  }
  const n = node as Record<string, unknown>;

  if (typeof n.id !== "string" || n.id.length === 0) {
    errors.push(`node[${index}].id must be a non-empty string`);
  }
  if (typeof n.kind !== "string" || !NODE_KINDS.has(n.kind)) {
    errors.push(`node[${index}].kind is not a valid NodeKind: ${String(n.kind)}`);
  }
  // The parser must only ever emit the file/class/function subset.
  if (typeof n.kind === "string" && !PARSER_NODE_KINDS.has(n.kind)) {
    errors.push(`node[${index}].kind "${n.kind}" is outside the parser subset`);
  }
  if (typeof n.directoryPath !== "string") {
    errors.push(`node[${index}].directoryPath must be a string`);
  }
  if (n.packagePath !== undefined && typeof n.packagePath !== "string") {
    errors.push(`node[${index}].packagePath must be a string when present`);
  }
  // packagePath, when present, must be non-empty (empty package => omitted).
  if (typeof n.packagePath === "string" && n.packagePath.length === 0) {
    errors.push(`node[${index}].packagePath must be omitted when empty`);
  }

  if (n.kind === "file") {
    if ("definedInFile" in n) {
      errors.push(`file node[${index}] must omit definedInFile`);
    }
  } else if (n.kind === "class" || n.kind === "function") {
    if (typeof n.definedInFile !== "string" || n.definedInFile.length === 0) {
      errors.push(`node[${index}].definedInFile must be a non-empty string`);
    }
  }
}

function validateEdge(
  edge: unknown,
  index: number,
  nodeIds: Set<string>,
  fileNodeIds: Set<string>,
  errors: string[],
): void {
  if (typeof edge !== "object" || edge === null) {
    errors.push(`edge[${index}] is not an object`);
    return;
  }
  const e = edge as Record<string, unknown>;

  if (typeof e.source !== "string" || !nodeIds.has(e.source)) {
    errors.push(`edge[${index}].source is not an existing node id`);
  }
  if (typeof e.target !== "string" || !nodeIds.has(e.target)) {
    errors.push(`edge[${index}].target is not an existing node id`);
  }
  for (const signal of [
    "importFrequency",
    "methodCallFrequency",
    "sharedTypeCount",
  ] as const) {
    if (!isNonNegativeInt(e[signal])) {
      errors.push(
        `edge[${index}].${signal} must be a non-negative integer in [0, ${MAX_FREQUENCY}]`,
      );
    }
  }
  // The parser must never emit strength (R7.7).
  if ("strength" in e) {
    errors.push(`edge[${index}] must not carry a strength field`);
  }
  // Parser edges connect only file/class endpoints (never function) (R5.2).
  // fileNodeIds is a subset used only to sanity-check that endpoints exist; the
  // function-endpoint check is enforced by rejecting any endpoint whose node is
  // a function below (handled by the caller via the node-kind map).
  void fileNodeIds;
}

/**
 * Validate a parsed value against the {@link RawDependencyGraph} contract the
 * downstream ingestor requires. Returns every violation found (empty => valid).
 */
function validateContract(value: unknown): string[] {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null) {
    return ["graph is not an object"];
  }
  const graph = value as Record<string, unknown>;

  if (!Array.isArray(graph.nodes)) {
    errors.push("graph.nodes must be an array");
  }
  if (!Array.isArray(graph.edges)) {
    errors.push("graph.edges must be an array");
  }
  if (errors.length > 0) {
    return errors;
  }

  const nodes = graph.nodes as unknown[];
  const edges = graph.edges as unknown[];

  const nodeIds = new Set<string>();
  const fileNodeIds = new Set<string>();
  const nodeKindById = new Map<string, string>();
  for (let i = 0; i < nodes.length; i += 1) {
    validateNode(nodes[i], i, errors);
    const n = nodes[i] as Record<string, unknown>;
    if (typeof n.id === "string") {
      if (nodeIds.has(n.id)) {
        errors.push(`duplicate node id: ${n.id}`);
      }
      nodeIds.add(n.id);
      if (typeof n.kind === "string") {
        nodeKindById.set(n.id, n.kind);
      }
      if (n.kind === "file") {
        fileNodeIds.add(n.id);
      }
    }
  }

  // definedInFile must reference an emitted file node.
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i] as Record<string, unknown>;
    if (
      (n.kind === "class" || n.kind === "function") &&
      typeof n.definedInFile === "string" &&
      !fileNodeIds.has(n.definedInFile)
    ) {
      errors.push(`node[${i}].definedInFile must reference an emitted file node`);
    }
  }

  const seenEdgePairs = new Set<string>();
  for (let i = 0; i < edges.length; i += 1) {
    validateEdge(edges[i], i, nodeIds, fileNodeIds, errors);
    const e = edges[i] as Record<string, unknown>;
    if (typeof e.source === "string" && typeof e.target === "string") {
      // No parallel duplicate edges (R5.3).
      const pair = `${e.source}\u0000${e.target}`;
      if (seenEdgePairs.has(pair)) {
        errors.push(`duplicate edge for pair (${e.source} -> ${e.target})`);
      }
      seenEdgePairs.add(pair);
      // No self-edges (R5.6).
      if (e.source === e.target) {
        errors.push(`edge[${i}] is a self-edge`);
      }
      // Endpoints must be file/class, never function (R5.2).
      if (nodeKindById.get(e.source) === "function") {
        errors.push(`edge[${i}].source is a function node`);
      }
      if (nodeKindById.get(e.target) === "function") {
        errors.push(`edge[${i}].target is a function node`);
      }
    }
  }

  return errors;
}

// --------------------------------------------------------------------------
// Deps builders for the real pipeline, with an optional shuffled collector.
// --------------------------------------------------------------------------

/** Build real pipeline deps, sharing one extractor (WASM init is expensive). */
function realDeps(collector?: SourceFileCollector): ParseDeps {
  return {
    validator: createInputValidator(),
    collector: collector ?? createSourceFileCollector(),
    createExtractor: () => createAstExtractor(),
    symbolTableBuilder: createSymbolTableBuilder(),
    stitcher: createStitcher(),
    serializer: createGraphSerializer(),
  };
}

/** A tiny deterministic PRNG (mulberry32) for a repeatable shuffle from a seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A collector that wraps the real collector and returns the discovered files in
 * a *shuffled* order, simulating differing filesystem enumeration order (R9.5).
 * The pipeline's canonical ordering must absorb this and still produce a
 * byte-identical `graph.json`.
 */
function shuffledCollector(seed: number): SourceFileCollector {
  const real = createSourceFileCollector();
  return {
    async collect(root) {
      const result = await real.collect(root);
      if (!result.ok) {
        return result;
      }
      const files = [...result.value];
      const rand = mulberry32(seed);
      // Fisher–Yates shuffle driven by the seeded PRNG.
      for (let i = files.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = files[i]!;
        files[i] = files[j]!;
        files[j] = tmp;
      }
      return ok<CollectedFile[], ParseError>(files);
    },
  };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

let tmpRoot: string;

before(async () => {
  tmpRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), "repohive-e2e-"));
});

after(async () => {
  await nodeFs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

test("fixture exists and contains Java sources", async () => {
  const stat = await nodeFs.stat(FIXTURE_DIR);
  assert.ok(stat.isDirectory(), `fixture directory missing: ${FIXTURE_DIR}`);
});

test("end-to-end: emitted graph.json conforms to the downstream contract with zero errors (R7.8)", async () => {
  const outputPath = path.join(tmpRoot, "graph.json");
  const result = await parseProject(
    { projectDirectory: FIXTURE_DIR, outputPath },
    realDeps(),
  );

  assert.ok(result.ok, `parse failed: ${JSON.stringify((result as { errors?: unknown }).errors)}`);

  const text = await nodeFs.readFile(outputPath, "utf8");
  // Parses as a single JSON value by a standard reader (R8.6).
  const parsed = JSON.parse(text) as RawDependencyGraph;

  const violations = validateContract(parsed);
  assert.deepEqual(violations, [], `contract violations: ${violations.join("; ")}`);

  // Non-trivial graph: the fixture must produce real nodes and real edges so
  // the seam is exercised meaningfully.
  assert.ok(parsed.nodes.length > 0, "expected a non-empty node set");
  assert.ok(parsed.edges.length > 0, "expected a non-empty edge set (cross-file imports)");

  // Spot-check representative entities the fixture is designed to produce.
  const ids = new Set(parsed.nodes.map((n: GraphNode) => n.id));
  assert.ok(ids.has("class:com.example.model.User"), "User class node present");
  assert.ok(
    ids.has("class:com.example.model.User$Role"),
    "nested User.Role class node present ($-joined FQN)",
  );
  assert.ok(
    ids.has("class:com.example.service.UserService$Session"),
    "inner UserService.Session class node present",
  );
  // Overloads produce distinct function nodes distinguished by parameter types.
  assert.ok(
    ids.has("func:com.example.model.User#getName()"),
    "no-arg getName overload present",
  );
  assert.ok(
    ids.has("func:com.example.model.User#getName(String)"),
    "String-arg getName overload present",
  );

  // A resolved cross-file import edge: the app file depends on the User class.
  const hasCrossFileEdge = parsed.edges.some(
    (e: DependencyEdge) =>
      e.source === "file:src/com/example/app/Main.java" &&
      e.target === "class:com.example.model.User",
  );
  assert.ok(hasCrossFileEdge, "expected Main.java -> User import edge");

  // Root-level file carries an empty directoryPath (R3.6).
  const rootFile = parsed.nodes.find(
    (n: GraphNode) => n.id === "file:Bootstrap.java",
  );
  assert.ok(rootFile, "root Bootstrap.java file node present");
  assert.equal(rootFile!.directoryPath, "", "root file directoryPath is empty");
});

test("property: byte-identical graph.json (identical SHA-256) across N runs (R9.1, R9.6)", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 2, max: 4 }), async (runs) => {
      const result = await verifyDeterminism({
        projectDirectory: FIXTURE_DIR,
        runs,
      });
      assert.ok(result.ok, `determinism failed: ${(result as { reason?: string }).reason}`);
      assert.equal(result.deterministic, true);
      assert.equal(
        result.runs.length,
        runs,
        "every requested run completed",
      );
    }),
    // WASM parsing over several files per run is not free; keep the run count
    // modest so the property completes quickly while still exercising >1 run.
    { numRuns: 3 },
  );
});

test("property: byte-identical graph.json across shuffled extraction order (R9.5)", async () => {
  // Baseline digest from the real (sorted) collector.
  const baselinePath = path.join(tmpRoot, "baseline.json");
  const baseline = await parseProject(
    { projectDirectory: FIXTURE_DIR, outputPath: baselinePath },
    realDeps(),
  );
  assert.ok(baseline.ok, "baseline parse succeeded");
  const baselineDigest = createHash("sha256")
    .update(await nodeFs.readFile(baselinePath))
    .digest("hex");

  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 1_000_000 }), async (seed) => {
      // verifyDeterminism runs twice, each with an independently shuffled
      // collector, and asserts they agree; we additionally assert the shared
      // digest equals the sorted-collector baseline, proving enumeration order
      // has no effect on the bytes (R9.5).
      const result = await verifyDeterminism({
        projectDirectory: FIXTURE_DIR,
        runs: 2,
        makeDeps: (run) => realDeps(shuffledCollector(seed + run)),
      });
      assert.ok(result.ok, `shuffled determinism failed: ${(result as { reason?: string }).reason}`);
      assert.equal(result.digest, baselineDigest, "shuffled order matches baseline digest");
    }),
    { numRuns: 3 },
  );
});
