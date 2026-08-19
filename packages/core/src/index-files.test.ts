import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import type { RawDependencyGraph } from "@repohive/shared";
import { INDEX_FILE_NAMES, serializeIndex } from "./index-serializer.js";
import { parseIndex } from "./index-parser.js";
import { groupGraph, type GroupingOutput } from "./orchestrator.js";
import { arbitraryDependencyGraph } from "./test-support/arbitraries.js";
import type { Metadata } from "./types.js";

/** Run the full pipeline; generated graphs are always valid so this must succeed. */
function runPipeline(graph: RawDependencyGraph): GroupingOutput {
  const result = groupGraph(graph);
  assert.ok(result.ok, "pipeline must succeed on a valid generated graph");
  return result.value;
}

function freshIndexDir(): string {
  return mkdtempSync(join(tmpdir(), "repohive-index-"));
}

function readJson(dir: string, name: string): unknown {
  return JSON.parse(readFileSync(join(dir, name), "utf8"));
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

/** Small fixed graph for the example (non-property) tests. */
const FIXED_GRAPH: RawDependencyGraph = {
  nodes: [
    { id: "file:src/com/alpha/A.java", kind: "file", packagePath: "com.alpha", directoryPath: "src/com/alpha" },
    { id: "file:src/com/alpha/B.java", kind: "file", packagePath: "com.alpha", directoryPath: "src/com/alpha" },
    { id: "file:src/com/beta/C.java", kind: "file", packagePath: "com.beta", directoryPath: "src/com/beta" },
  ],
  edges: [
    {
      source: "file:src/com/alpha/A.java",
      target: "file:src/com/alpha/B.java",
      importFrequency: 2,
      methodCallFrequency: 1,
      sharedTypeCount: 0,
    },
    {
      source: "file:src/com/alpha/B.java",
      target: "file:src/com/beta/C.java",
      importFrequency: 1,
      methodCallFrequency: 0,
      sharedTypeCount: 1,
    },
  ],
};

// Feature: hierarchical-repository-grouping, Property 29: Serialization writes a complete, count-consistent index file set
test("Property 29: serialization writes a complete, count-consistent index file set (R9.1-9.4, R11.3, R11.4)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const { hierarchy, metadata } = runPipeline(graph);
      const dir = freshIndexDir();
      try {
        const written = serializeIndex(hierarchy, metadata, dir);
        assert.ok(written.ok, "serialization must succeed into a fresh directory");

        // R9.1: the directory contains exactly the five index files.
        assert.deepEqual(readdirSync(dir).sort(), [...INDEX_FILE_NAMES].sort());

        // R9.2: nodes.json lists one entry per hierarchy node.
        const nodesDoc = readJson(dir, "nodes.json") as { nodes: unknown[] };
        assert.equal(nodesDoc.nodes.length, hierarchy.nodes.size);

        // R9.3: edges.json carries every leaf and cross-group edge.
        const edgesDoc = readJson(dir, "edges.json") as { leafEdges: unknown[]; crossGroupEdges: unknown[] };
        assert.equal(edgesDoc.leafEdges.length, hierarchy.leafEdges.length);
        assert.equal(edgesDoc.crossGroupEdges.length, hierarchy.crossGroupEdges.length);

        // R9.4 + R11.3/R11.4: metadata.json records the audit + scalability stats.
        const meta = readJson(dir, "metadata.json") as Metadata;
        assert.equal(meta.structuralQualityBoundary, metadata.structuralQualityBoundary);
        assert.deepEqual(meta.metricWeights, metadata.metricWeights);
        assert.equal(meta.cohesionSquashConstant, metadata.cohesionSquashConstant);

        // One decision per Region: unique regionIds, count matching the in-memory record.
        assert.ok(Array.isArray(meta.regionDecisions));
        assert.equal(meta.regionDecisions.length, metadata.regionDecisions.length);
        assert.equal(new Set(meta.regionDecisions.map((d) => d.regionId)).size, meta.regionDecisions.length);

        assert.equal(meta.nodeCount, hierarchy.nodes.size);
        assert.equal(meta.edgeCount, hierarchy.leafEdges.length + hierarchy.crossGroupEdges.length);
        assert.equal(meta.hierarchyDepth, hierarchy.depth);

        // Per-level stats sum to the totals.
        assert.ok(Array.isArray(meta.perLevel) && meta.perLevel.length > 0);
        assert.equal(
          sum(meta.perLevel.map((l) => l.groupNodeCount + l.leafNodeCount)),
          meta.nodeCount
        );
        assert.equal(sum(meta.perLevel.map((l) => l.leafEdgeCount)), hierarchy.leafEdges.length);
        assert.equal(sum(meta.perLevel.map((l) => l.crossGroupEdgeCount)), meta.totalCrossGroupEdges);

        assert.equal(meta.totalCrossGroupEdges, hierarchy.crossGroupEdges.length);

        // averageBranchingFactor recomputed independently from the hierarchy:
        // mean child count over repository + group nodes.
        const containers = [...hierarchy.nodes.values()].filter(
          (n) => n.kind === "group" || n.kind === "repository"
        );
        const expectedBranching =
          containers.length > 0
            ? sum(containers.map((n) => n.childIds.length)) / containers.length
            : 0;
        assert.ok(
          Math.abs(meta.averageBranchingFactor - expectedBranching) < 1e-9,
          `averageBranchingFactor ${meta.averageBranchingFactor} must equal recomputed ${expectedBranching}`
        );

        // Per-level node counts recomputed independently from node levels.
        for (const levelStats of meta.perLevel) {
          const atLevel = [...hierarchy.nodes.values()].filter((n) => n.level === levelStats.level);
          assert.equal(
            levelStats.groupNodeCount,
            atLevel.filter((n) => n.kind === "group" || n.kind === "repository").length
          );
          assert.equal(
            levelStats.leafNodeCount,
            atLevel.filter((n) => n.kind !== "group" && n.kind !== "repository").length
          );
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }),
    // numRuns reduced to 30: every run performs real filesystem I/O.
    { numRuns: 30 }
  );
});

// Feature: hierarchical-repository-grouping, Property 30: Serialize-then-parse round-trip preserves the hierarchy
test("Property 30: serialize-then-parse round-trip preserves the hierarchy (R9.5)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const { hierarchy, metadata } = runPipeline(graph);
      const dir = freshIndexDir();
      try {
        const written = serializeIndex(hierarchy, metadata, dir);
        assert.ok(written.ok);

        const parsed = parseIndex(dir);
        assert.ok(parsed.ok, "a freshly serialized index must parse");
        const roundTripped = parsed.value;

        // Full structural fidelity: every HierarchyNode record survives —
        // kind, level, parentId, and childIds ordering included.
        assert.deepEqual(
          new Set(roundTripped.hierarchy.nodes.keys()),
          new Set(hierarchy.nodes.keys())
        );
        for (const [id, original] of hierarchy.nodes) {
          assert.deepEqual(roundTripped.hierarchy.nodes.get(id), original);
        }
        assert.equal(roundTripped.hierarchy.repositoryId, hierarchy.repositoryId);

        // Leaf attributes survive for every leaf node.
        for (const [id, attributes] of hierarchy.leafAttributes) {
          const node = hierarchy.nodes.get(id);
          if (node && node.kind !== "group" && node.kind !== "repository") {
            assert.deepEqual(roundTripped.hierarchy.leafAttributes.get(id), attributes);
          }
        }

        // Same leaf-edge multiset over the FULL edge content (signals too).
        const leafKey = (e: {
          source: string;
          target: string;
          importFrequency: number;
          methodCallFrequency: number;
          sharedTypeCount: number;
          strength?: number;
        }) =>
          JSON.stringify([
            e.source,
            e.target,
            e.importFrequency,
            e.methodCallFrequency,
            e.sharedTypeCount,
            e.strength,
          ]);
        assert.deepEqual(
          roundTripped.hierarchy.leafEdges.map(leafKey).sort(),
          hierarchy.leafEdges.map(leafKey).sort()
        );

        // Same cross-group edges and depth.
        assert.deepEqual(roundTripped.hierarchy.crossGroupEdges, hierarchy.crossGroupEdges);
        assert.equal(roundTripped.hierarchy.depth, hierarchy.depth);

        // Per-Region decisions survive intact.
        assert.deepEqual(roundTripped.metadata.regionDecisions, metadata.regionDecisions);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }),
    // numRuns reduced to 30: every run performs real filesystem I/O.
    { numRuns: 30 }
  );
});

// Feature: hierarchical-repository-grouping, Property 31: Parsing reports all missing member files atomically
test("Property 31: parsing reports all missing member files atomically (R9.6)", () => {
  fc.assert(
    fc.property(
      arbitraryDependencyGraph(),
      fc.subarray(INDEX_FILE_NAMES as unknown as string[], { minLength: 1 }),
      (graph, deleted) => {
        const { hierarchy, metadata } = runPipeline(graph);
        const dir = freshIndexDir();
        try {
          const written = serializeIndex(hierarchy, metadata, dir);
          assert.ok(written.ok);
          for (const name of deleted) {
            unlinkSync(join(dir, name));
          }

          const result = parseIndex(dir);
          assert.ok(!result.ok, "parsing an incomplete index must fail");
          assert.ok(result.error.code === "MISSING_FILES", `expected MISSING_FILES, got ${result.error.code}`);
          assert.deepEqual([...result.error.files].sort(), [...deleted].sort());
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    ),
    // numRuns reduced to 30: every run performs real filesystem I/O.
    { numRuns: 30 }
  );
});

test("invalid JSON in metadata.json is reported as MALFORMED_FILE naming the file (R9.7)", () => {
  const { hierarchy, metadata } = runPipeline(FIXED_GRAPH);
  const dir = freshIndexDir();
  try {
    const written = serializeIndex(hierarchy, metadata, dir);
    assert.ok(written.ok);
    writeFileSync(join(dir, "metadata.json"), "not json{", "utf8");

    const result = parseIndex(dir);
    assert.ok(!result.ok);
    assert.ok(result.error.code === "MALFORMED_FILE", `expected MALFORMED_FILE, got ${result.error.code}`);
    assert.equal(result.error.file, "metadata.json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hierarchy.json missing its nodes field is reported as MALFORMED_FILE naming the file (R9.7)", () => {
  const { hierarchy, metadata } = runPipeline(FIXED_GRAPH);
  const dir = freshIndexDir();
  try {
    const written = serializeIndex(hierarchy, metadata, dir);
    assert.ok(written.ok);
    // Valid JSON, but the required "nodes" array is absent.
    writeFileSync(join(dir, "hierarchy.json"), JSON.stringify({ repositoryId: hierarchy.repositoryId }), "utf8");

    const result = parseIndex(dir);
    assert.ok(!result.ok);
    assert.ok(result.error.code === "MALFORMED_FILE", `expected MALFORMED_FILE, got ${result.error.code}`);
    assert.equal(result.error.file, "hierarchy.json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("serializing into a path that is an existing file fails with WRITE_FAILED (R9.8)", () => {
  const { hierarchy, metadata } = runPipeline(FIXED_GRAPH);
  const dir = freshIndexDir();
  try {
    const blockingFile = join(dir, "not-a-directory");
    writeFileSync(blockingFile, "plain file occupying the target path", "utf8");

    const result = serializeIndex(hierarchy, metadata, blockingFile);
    assert.ok(!result.ok, "writing into a file path must fail");
    assert.equal(result.error.code, "WRITE_FAILED");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tampered index sets are rejected: wrong-typed fields, ghost references, duplicates, and missing metadata fields (R9.7)", () => {
  const graph: RawDependencyGraph = {
    nodes: [
      { id: "file:src/com/t/T1.java", kind: "file", packagePath: "com.t", directoryPath: "src/com/t" },
      { id: "file:src/com/t/T2.java", kind: "file", packagePath: "com.t", directoryPath: "src/com/t" },
    ],
    edges: [
      { source: "file:src/com/t/T1.java", target: "file:src/com/t/T2.java", importFrequency: 2, methodCallFrequency: 0, sharedTypeCount: 0 },
    ],
  };
  const result = groupGraph(graph);
  assert.ok(result.ok);

  /** Serialize fresh, apply a JSON tamper to one file, and parse. */
  const parseTampered = (
    file: string,
    tamper: (doc: Record<string, unknown>) => void
  ): ReturnType<typeof parseIndex> => {
    const dir = mkdtempSync(join(tmpdir(), "repohive-tamper-"));
    try {
      assert.ok(serializeIndex(result.value.hierarchy, result.value.metadata, dir).ok);
      const doc = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
      tamper(doc);
      writeFileSync(join(dir, file), JSON.stringify(doc), "utf8");
      return parseIndex(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const expectMalformed = (parsed: ReturnType<typeof parseIndex>, file: string): void => {
    assert.ok(!parsed.ok, `tampered ${file} must be rejected`);
    assert.equal(parsed.error.code, "MALFORMED_FILE");
    assert.ok("file" in parsed.error && parsed.error.file === file);
  };

  // Wrong-typed childIds elements.
  expectMalformed(
    parseTampered("hierarchy.json", (doc) => {
      (doc.nodes as Array<{ childIds: unknown[] }>)[0]!.childIds = [42, { evil: true }];
    }),
    "hierarchy.json"
  );

  // Ghost leaf-edge endpoint.
  expectMalformed(
    parseTampered("edges.json", (doc) => {
      (doc.leafEdges as Array<{ source: string }>)[0]!.source = "ghost:nowhere";
    }),
    "edges.json"
  );

  // Duplicate + omitted nodes.json entry (defeats plain count checks).
  expectMalformed(
    parseTampered("nodes.json", (doc) => {
      const nodes = doc.nodes as Array<Record<string, unknown>>;
      nodes[1] = { ...nodes[0]! };
    }),
    "nodes.json"
  );

  // Missing required metadata scalability fields (R11.4).
  expectMalformed(
    parseTampered("metadata.json", (doc) => {
      delete doc.totalCrossGroupEdges;
      delete doc.averageBranchingFactor;
    }),
    "metadata.json"
  );

  // Wrong-typed metricWeights.
  expectMalformed(
    parseTampered("metadata.json", (doc) => {
      doc.metricWeights = "banana";
    }),
    "metadata.json"
  );
});
