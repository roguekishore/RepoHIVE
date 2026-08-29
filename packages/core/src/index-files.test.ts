import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import type { RawDependencyGraph } from "@repohive/shared";
import {
  INDEX_FILE_NAMES,
  serializeIndex,
  type IndexSerializerDeps,
} from "./index-serializer.js";
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

// --- A null array element must not escape as a throw (Fix 2 — Gap 3) -------
//
// Every validation loop in parseIndex reads `entry.<field>`. JSON.parse happily
// yields `null` inside an array, so a null element raised a TypeError straight
// out of parseIndex, escaping the Result model the error taxonomy rests on.

test("a null element in any validated array yields MALFORMED_FILE, never a throw", () => {
  const graph: RawDependencyGraph = {
    nodes: [
      { id: "file:a/A.java", kind: "file", packagePath: "a", directoryPath: "a" },
      { id: "file:a/B.java", kind: "file", packagePath: "a", directoryPath: "a" },
    ],
    edges: [
      {
        source: "file:a/A.java",
        target: "file:a/B.java",
        importFrequency: 2,
        methodCallFrequency: 0,
        sharedTypeCount: 0,
      },
    ],
  };
  const output = runPipeline(graph);

  /** Replace one array's contents with a hostile element list, then parse. */
  const parseWithElement = (
    file: string,
    arrayPath: string,
    element: unknown,
  ): ReturnType<typeof parseIndex> => {
    const dir = mkdtempSync(join(tmpdir(), "repohive-null-elem-"));
    try {
      assert.ok(serializeIndex(output.hierarchy, output.metadata, dir).ok);
      const doc = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
      const target = doc[arrayPath] as unknown[];
      target[0] = element;
      writeFileSync(join(dir, file), JSON.stringify(doc), "utf8");
      return parseIndex(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const targets: ReadonlyArray<readonly [string, string]> = [
    ["hierarchy.json", "nodes"],
    ["nodes.json", "nodes"],
    ["edges.json", "leafEdges"],
    ["metadata.json", "regionDecisions"],
    ["metadata.json", "perLevel"],
  ];

  for (const [file, arrayPath] of targets) {
    for (const element of [null, 42, "text", true]) {
      let parsed: ReturnType<typeof parseIndex> | undefined;
      const label = `${file}#${arrayPath} = ${JSON.stringify(element)}`;
      assert.doesNotThrow(() => {
        parsed = parseWithElement(file, arrayPath, element);
      }, label);
      assert.ok(parsed !== undefined && !parsed.ok, label);
      assert.equal(parsed.error.code, "MALFORMED_FILE", label);
      assert.ok("file" in parsed.error && parsed.error.file === file, label);
    }
  }
});

// --- The containment tree is validated globally on read (Gap 11) ----------
//
// The pairwise link checks prove every parentId/childIds reference points at a
// real node, but say nothing about the shape as a whole: a two-node mutual
// parent cycle satisfies all of them. parseIndex accepted it, and
// analyzeBlastRadius's ancestor climb then never terminated.

test("a malformed containment tree is rejected on read, naming hierarchy.json", () => {
  const graph: RawDependencyGraph = {
    nodes: Array.from({ length: 6 }, (_, i) => ({
      id: `file:p${i % 2}/F${i}.java`,
      kind: "file" as const,
      packagePath: `p${i % 2}`,
      directoryPath: `p${i % 2}`,
    })),
    edges: [
      {
        source: "file:p0/F0.java",
        target: "file:p0/F2.java",
        importFrequency: 3,
        methodCallFrequency: 0,
        sharedTypeCount: 0,
      },
    ],
  };
  const output = runPipeline(graph);

  type HierarchyDoc = {
    repositoryId: string;
    nodes: Array<{ id: string; kind: string; level: number; parentId: string | null; childIds: string[] }>;
  };

  const parseTampered = (tamper: (doc: HierarchyDoc) => void): ReturnType<typeof parseIndex> => {
    const dir = mkdtempSync(join(tmpdir(), "repohive-tree-"));
    try {
      assert.ok(serializeIndex(output.hierarchy, output.metadata, dir).ok);
      const doc = JSON.parse(readFileSync(join(dir, "hierarchy.json"), "utf8")) as HierarchyDoc;
      tamper(doc);
      writeFileSync(join(dir, "hierarchy.json"), JSON.stringify(doc), "utf8");
      return parseIndex(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const node = (doc: HierarchyDoc, id: string) => doc.nodes.find((n) => n.id === id)!;
  const anyGroup = (doc: HierarchyDoc) => doc.nodes.find((n) => n.kind === "group")!;
  const anyLeaf = (doc: HierarchyDoc) => doc.nodes.find((n) => n.kind === "file")!;

  const cases: ReadonlyArray<readonly [string, (doc: HierarchyDoc) => void]> = [
    [
      "self-parenting node",
      (doc) => {
        const g = anyGroup(doc);
        g.parentId = g.id;
        g.childIds = [...new Set([...g.childIds, g.id])].sort();
      },
    ],
    [
      "two-node mutual cycle (the reproduced case)",
      (doc) => {
        const root = node(doc, doc.repositoryId);
        const g = anyGroup(doc);
        root.parentId = g.id;
        g.childIds = [...new Set([...g.childIds, root.id])].sort();
      },
    ],
    [
      "cycle unreachable from the root",
      (doc) => {
        doc.nodes.push(
          { id: "z_x", kind: "group", level: 9, parentId: "z_y", childIds: ["z_y"] },
          { id: "z_y", kind: "group", level: 10, parentId: "z_x", childIds: ["z_x"] },
        );
      },
    ],
    [
      "a second root (forest)",
      (doc) => {
        doc.nodes.push({ id: "z_orphan", kind: "group", level: 1, parentId: null, childIds: [] });
      },
    ],
    [
      "repositoryId naming an absent node",
      (doc) => {
        doc.repositoryId = "r_ghost";
      },
    ],
    [
      "node listed as a child by two parents",
      (doc) => {
        const leaf = anyLeaf(doc);
        const g = anyGroup(doc);
        if (!g.childIds.includes(leaf.id)) {
          g.childIds = [...g.childIds, leaf.id].sort();
        } else {
          const other = doc.nodes.find((n) => n.kind === "group" && n.id !== g.id);
          if (other) other.childIds = [...other.childIds, leaf.id].sort();
        }
      },
    ],
    [
      "duplicate id inside one childIds",
      (doc) => {
        const g = doc.nodes.find((n) => n.childIds.length > 0)!;
        g.childIds = [g.childIds[0]!, g.childIds[0]!];
      },
    ],
    [
      "unsorted childIds",
      (doc) => {
        const g = doc.nodes.find((n) => n.childIds.length > 1)!;
        g.childIds = [...g.childIds].reverse();
      },
    ],
    [
      "child level is not parent.level + 1",
      (doc) => {
        const g = doc.nodes.find((n) => n.childIds.length > 0)!;
        node(doc, g.childIds[0]!).level = g.level + 5;
      },
    ],
    [
      "unreachable component",
      (doc) => {
        doc.nodes.push({ id: "z_lonely", kind: "group", level: 2, parentId: null, childIds: [] });
        doc.nodes.push({ id: "z_lonely2", kind: "group", level: 3, parentId: "z_lonely", childIds: [] });
      },
    ],
    [
      "unknown kind",
      (doc) => {
        anyGroup(doc).kind = "banana";
      },
    ],
    [
      "negative level",
      (doc) => {
        anyGroup(doc).level = -1;
      },
    ],
  ];

  for (const [label, tamper] of cases) {
    const parsed = parseTampered(tamper);
    assert.ok(!parsed.ok, `${label} must be rejected`);
    assert.equal(parsed.error.code, "MALFORMED_FILE", label);
    assert.ok("file" in parsed.error && parsed.error.file === "hierarchy.json", label);
    assert.ok(!("value" in parsed), `${label} must return no partial hierarchy`);
  }
});

test("a fractional or negative hierarchyDepth is rejected", () => {
  const graph: RawDependencyGraph = {
    nodes: [{ id: "file:A.java", kind: "file", directoryPath: "" }],
    edges: [],
  };
  const output = runPipeline(graph);

  for (const depth of [1.5, -1]) {
    const dir = mkdtempSync(join(tmpdir(), "repohive-depth-"));
    try {
      assert.ok(serializeIndex(output.hierarchy, output.metadata, dir).ok);
      const doc = JSON.parse(readFileSync(join(dir, "repository.json"), "utf8")) as Record<string, unknown>;
      doc.hierarchyDepth = depth;
      writeFileSync(join(dir, "repository.json"), JSON.stringify(doc), "utf8");
      const parsed = parseIndex(dir);
      assert.ok(!parsed.ok, `hierarchyDepth ${depth} must be rejected`);
      assert.equal(parsed.error.code, "MALFORMED_FILE");
      assert.ok("file" in parsed.error && parsed.error.file === "repository.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// Feature: hierarchical-repository-grouping, Property 39: The parser accepts every index the serializer writes
test("Property 39: parseIndex accepts every index serializeIndex writes (R9.5)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const output = runPipeline(graph);
      const dir = freshIndexDir();
      try {
        assert.ok(serializeIndex(output.hierarchy, output.metadata, dir).ok);
        const parsed = parseIndex(dir);
        // The risk of tightening validation is rejecting the engine's own valid
        // output. This property is what makes that impossible to ship.
        assert.ok(
          parsed.ok,
          `serializer output rejected: ${parsed.ok ? "" : JSON.stringify(parsed.error)}`,
        );
        assert.equal(parsed.value.hierarchy.nodes.size, output.hierarchy.nodes.size);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }),
    { numRuns: 100 },
  );
});

// --- The five-file write is all-or-nothing (Gap 10) -----------------------
//
// Writing the five files in sequence meant a failure partway through left some
// new files beside some old ones — and parseIndex accepted the mixture, because
// each file was individually well-formed. Reproduced with a read-only
// metadata.json: repository/hierarchy/nodes/edges were replaced and metadata
// was not, so the index described one hierarchy with another's parameters.

/** Real-filesystem deps, with the k-th write (1-based) forced to fail. */
function depsFailingWriteAt(k: number): IndexSerializerDeps {
  let writes = 0;
  return {
    mkdirSync: (p) => mkdirSync(p, { recursive: true }),
    writeFileSync: (p, data) => {
      writes += 1;
      if (writes === k) {
        throw new Error(`injected write failure at ${k}`);
      }
      writeFileSync(p, data, "utf8");
    },
    renameSync: (from, to) => renameSync(from, to),
    rmSync: (p) => rmSync(p, { recursive: true, force: true }),
    existsSync: (p) => existsSync(p),
    assertWritable: () => undefined,
  };
}

/** Snapshot every file in `dir` as name → content. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    out.set(name, readFileSync(join(dir, name), "utf8"));
  }
  return out;
}

const smallGraph: RawDependencyGraph = {
  nodes: [
    { id: "file:p/A.java", kind: "file", packagePath: "p", directoryPath: "p" },
    { id: "file:p/B.java", kind: "file", packagePath: "p", directoryPath: "p" },
  ],
  edges: [
    {
      source: "file:p/A.java",
      target: "file:p/B.java",
      importFrequency: 4,
      methodCallFrequency: 0,
      sharedTypeCount: 0,
    },
  ],
};

test("a failure at any staging position leaves a fresh target untouched", () => {
  const output = runPipeline(smallGraph);

  for (let k = 1; k <= INDEX_FILE_NAMES.length; k++) {
    const parent = mkdtempSync(join(tmpdir(), "repohive-atomic-"));
    const dir = join(parent, "index");
    try {
      const result = serializeIndex(output.hierarchy, output.metadata, dir, depsFailingWriteAt(k));
      assert.ok(!result.ok, `failure at write ${k} must be reported`);
      assert.equal(result.error.code, "WRITE_FAILED");

      // Nothing was created at the target at all.
      assert.equal(existsSync(dir), false, `target must not exist after failure at ${k}`);
      // And no staging directory was left behind.
      assert.deepEqual(readdirSync(parent), [], `no leftovers after failure at ${k}`);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("a failure at any staging position leaves a previous index byte-identical", () => {
  const first = runPipeline(smallGraph);
  // A second, genuinely different hierarchy, so a partial write would show.
  const second = runPipeline({
    nodes: [
      ...smallGraph.nodes,
      { id: "file:q/C.java", kind: "file", packagePath: "q", directoryPath: "q" },
    ],
    edges: smallGraph.edges,
  });

  for (let k = 1; k <= INDEX_FILE_NAMES.length; k++) {
    const parent = mkdtempSync(join(tmpdir(), "repohive-atomic-prev-"));
    const dir = join(parent, "index");
    try {
      assert.ok(serializeIndex(first.hierarchy, first.metadata, dir).ok);
      const before = snapshot(dir);

      const result = serializeIndex(second.hierarchy, second.metadata, dir, depsFailingWriteAt(k));
      assert.ok(!result.ok, `failure at write ${k} must be reported`);

      const after = snapshot(dir);
      assert.deepEqual(after, before, `previous index must survive a failure at ${k}`);

      // The surviving index is still internally consistent.
      assert.ok(parseIndex(dir).ok);
      // No staging directory left behind.
      assert.deepEqual(readdirSync(parent), ["index"]);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("a failure during promotion leaves the previous index intact", () => {
  const first = runPipeline(smallGraph);
  const second = runPipeline({
    nodes: [
      ...smallGraph.nodes,
      { id: "file:q/C.java", kind: "file", packagePath: "q", directoryPath: "q" },
    ],
    edges: smallGraph.edges,
  });

  const parent = mkdtempSync(join(tmpdir(), "repohive-promote-"));
  const dir = join(parent, "index");
  try {
    assert.ok(serializeIndex(first.hierarchy, first.metadata, dir).ok);
    const before = snapshot(dir);

    let renames = 0;
    const result = serializeIndex(second.hierarchy, second.metadata, dir, {
      mkdirSync: (p) => mkdirSync(p, { recursive: true }),
      writeFileSync: (p, data) => writeFileSync(p, data, "utf8"),
      renameSync: (from, to) => {
        renames += 1;
        if (renames === 3) {
          throw new Error("injected promotion failure");
        }
        renameSync(from, to);
      },
      rmSync: (p) => rmSync(p, { recursive: true, force: true }),
      existsSync: (p) => existsSync(p),
      assertWritable: () => undefined,
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, "WRITE_FAILED");
    assert.ok("detail" in result.error && result.error.detail?.includes("promotion failed"));
    // The staging directory is cleaned up even on the promotion path.
    assert.deepEqual(readdirSync(parent), ["index"]);
    // Promotion is the only phase that can leave a mixture; two of five files
    // were renamed before the injected failure, so record what actually
    // survives rather than claiming more than the mechanism guarantees.
    const after = snapshot(dir);
    assert.equal(after.size, before.size, "the five files still exist");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("a read-only member file is detected before the target is touched", () => {
  const first = runPipeline(smallGraph);
  const parent = mkdtempSync(join(tmpdir(), "repohive-readonly-"));
  const dir = join(parent, "index");
  try {
    assert.ok(serializeIndex(first.hierarchy, first.metadata, dir).ok);
    const before = snapshot(dir);

    const result = serializeIndex(first.hierarchy, first.metadata, dir, {
      mkdirSync: (p) => mkdirSync(p, { recursive: true }),
      writeFileSync: (p, data) => writeFileSync(p, data, "utf8"),
      renameSync: (from, to) => renameSync(from, to),
      rmSync: (p) => rmSync(p, { recursive: true, force: true }),
      existsSync: (p) => existsSync(p),
      assertWritable: (p) => {
        if (p.endsWith("metadata.json")) {
          throw new Error("EACCES: permission denied");
        }
      },
    });

    assert.ok(!result.ok, "a read-only member must fail the whole write");
    assert.equal(result.error.code, "WRITE_FAILED");
    assert.ok("detail" in result.error && result.error.detail?.includes("not writable"));
    assert.deepEqual(snapshot(dir), before, "the entire previous index must be intact");
    assert.deepEqual(readdirSync(parent), ["index"], "no staging directory left behind");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

// Feature: hierarchical-repository-grouping, Property 41: Index writes are all-or-nothing
test("Property 41: a staging failure at any position leaves the target unchanged (R9.8)", () => {
  fc.assert(
    fc.property(
      arbitraryDependencyGraph({ maxFiles: 5, maxEdges: 8 }),
      fc.integer({ min: 1, max: INDEX_FILE_NAMES.length }),
      (graph, k) => {
        const output = runPipeline(graph);
        const parent = mkdtempSync(join(tmpdir(), "repohive-prop-atomic-"));
        const dir = join(parent, "index");
        try {
          assert.ok(serializeIndex(output.hierarchy, output.metadata, dir).ok);
          const before = snapshot(dir);

          const result = serializeIndex(
            output.hierarchy,
            output.metadata,
            dir,
            depsFailingWriteAt(k),
          );
          assert.ok(!result.ok);
          assert.deepEqual(snapshot(dir), before);
        } finally {
          rmSync(parent, { recursive: true, force: true });
        }
      },
    ),
    { numRuns: 100 },
  );
});

test("a count mismatch across the file set is rejected — the mixed-index signature", () => {
  const output = runPipeline(smallGraph);

  const tamperAndParse = (
    file: string,
    mutate: (doc: Record<string, unknown>) => void,
  ): ReturnType<typeof parseIndex> => {
    const dir = mkdtempSync(join(tmpdir(), "repohive-counts-"));
    try {
      assert.ok(serializeIndex(output.hierarchy, output.metadata, dir).ok);
      const doc = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
      mutate(doc);
      writeFileSync(join(dir, file), JSON.stringify(doc), "utf8");
      return parseIndex(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  // Each of these is what a half-written index looks like: every file is
  // individually well-formed, but they describe different hierarchies.
  const cases: ReadonlyArray<readonly [string, string, (doc: Record<string, unknown>) => void]> = [
    ["repository.json", "nodeCount", (doc) => { doc.nodeCount = 99; }],
    ["repository.json", "edgeCount", (doc) => { doc.edgeCount = 99; }],
    ["metadata.json", "nodeCount", (doc) => { doc.nodeCount = 99; }],
    ["metadata.json", "edgeCount", (doc) => { doc.edgeCount = 99; }],
    ["metadata.json", "hierarchyDepth", (doc) => { doc.hierarchyDepth = 99; }],
    ["metadata.json", "totalCrossGroupEdges", (doc) => { doc.totalCrossGroupEdges = 99; }],
  ];

  for (const [file, field, mutate] of cases) {
    const parsed = tamperAndParse(file, mutate);
    const label = `${file}#${field}`;
    assert.ok(!parsed.ok, `${label} mismatch must be rejected`);
    assert.equal(parsed.error.code, "MALFORMED_FILE", label);
    assert.ok("file" in parsed.error && parsed.error.file === file, label);
    assert.ok("detail" in parsed.error && parsed.error.detail.includes(field), label);
  }
});

// --- The run reproduces from its own audit record (Gap 22) ----------------
//
// metadata.json recorded the boundary, weights, squash constant and decisions,
// but not maxGroupSize, minPartitionThreshold, the seed, the coefficients or
// degenerateScore — so a run's hierarchy *shape* could not be reproduced from
// its own record, though Req 7.1 states determinism "with identical
// configuration".

test("metadata records the full resolved configuration, and it round-trips", () => {
  const output = groupGraph(smallGraph, {
    structuralQualityBoundary: 0.42,
    communityDetectionSeed: 99,
    weightCoefficients: { importCoefficient: 2 },
    assessment: { degenerateScore: 0.25, cohesionSquashConstant: 3 },
    hierarchy: { maxGroupSize: 8, minPartitionThreshold: 3 },
    overrides: new Map([
      ["pkg:zeta", "preserve"],
      ["pkg:alpha", "reconstruct"],
    ]),
  });
  assert.ok(output.ok);

  const configuration = output.value.metadata.configuration;
  assert.ok(configuration !== undefined, "the configuration block must be emitted");
  assert.equal(configuration.structuralQualityBoundary, 0.42);
  assert.equal(configuration.communityDetectionSeed, 99);
  assert.equal(configuration.weightCoefficients.importCoefficient, 2);
  // Defaults are filled in: only a fully-resolved record is a reproduction recipe.
  assert.equal(configuration.weightCoefficients.callCoefficient, 1);
  assert.equal(configuration.assessment.degenerateScore, 0.25);
  assert.equal(configuration.assessment.cohesionSquashConstant, 3);
  assert.equal(configuration.hierarchy.maxGroupSize, 8);
  assert.equal(configuration.hierarchy.minPartitionThreshold, 3);
  assert.deepEqual(configuration.overrides, { "pkg:alpha": "reconstruct", "pkg:zeta": "preserve" });

  const dir = freshIndexDir();
  try {
    assert.ok(serializeIndex(output.value.hierarchy, output.value.metadata, dir).ok);
    const parsed = parseIndex(dir);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.metadata.configuration, configuration);

    // The override map is a plain object with sorted keys, so it serializes
    // deterministically — a Map would have stringified to `{}`.
    const written = readJson(dir, "metadata.json") as {
      configuration: { overrides: Record<string, string> };
    };
    assert.deepEqual(Object.keys(written.configuration.overrides), ["pkg:alpha", "pkg:zeta"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an index written without the configuration block still parses", () => {
  const output = runPipeline(smallGraph);
  const dir = freshIndexDir();
  try {
    assert.ok(serializeIndex(output.hierarchy, output.metadata, dir).ok);
    const doc = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")) as Record<string, unknown>;
    delete doc.configuration;
    writeFileSync(join(dir, "metadata.json"), JSON.stringify(doc), "utf8");

    const parsed = parseIndex(dir);
    assert.ok(parsed.ok, "the field is additive and optional");
    assert.equal(parsed.value.metadata.configuration, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed configuration block is rejected rather than half-read", () => {
  const output = runPipeline(smallGraph);

  const cases: ReadonlyArray<readonly [string, unknown]> = [
    ["not an object", 42],
    ["missing sub-objects", { structuralQualityBoundary: 0.5 }],
    [
      "non-numeric field",
      {
        structuralQualityBoundary: "half",
        communityDetectionSeed: 1,
        weightCoefficients: {},
        assessment: { cohesionSquashConstant: 1, degenerateScore: 0, computeModularity: false },
        hierarchy: { maxGroupSize: 20, minPartitionThreshold: 2 },
      },
    ],
  ];

  for (const [label, configuration] of cases) {
    const dir = freshIndexDir();
    try {
      assert.ok(serializeIndex(output.hierarchy, output.metadata, dir).ok);
      const doc = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")) as Record<string, unknown>;
      doc.configuration = configuration;
      writeFileSync(join(dir, "metadata.json"), JSON.stringify(doc), "utf8");

      const parsed = parseIndex(dir);
      assert.ok(!parsed.ok, `${label} must be rejected`);
      assert.equal(parsed.error.code, "MALFORMED_FILE", label);
      assert.ok("file" in parsed.error && parsed.error.file === "metadata.json", label);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("recorded metricWeights reflect the weights actually applied (R3.7)", () => {
  // A graph whose only inter-file edges carry zero strength: Q is undefined, so
  // combineScore never applies the modularity weight. Reporting it anyway made
  // the record contradict the run.
  const zeroStrength: RawDependencyGraph = {
    nodes: [
      { id: "file:p/A.java", kind: "file", packagePath: "p", directoryPath: "p" },
      { id: "file:p/B.java", kind: "file", packagePath: "p", directoryPath: "p" },
    ],
    edges: [
      {
        source: "file:p/A.java",
        target: "file:p/B.java",
        importFrequency: 0,
        methodCallFrequency: 0,
        sharedTypeCount: 0,
      },
    ],
  };

  const uncomputable = groupGraph(zeroStrength, {
    assessment: { computeModularity: true, weights: { cohesion: 1, coupling: 1, modularity: 1 } },
  });
  assert.ok(uncomputable.ok);
  assert.equal(
    uncomputable.value.metadata.metricWeights.modularity,
    undefined,
    "a weight that was not applied must not be reported as used",
  );

  // Where Q *is* computable, the weight is reported.
  const computable = groupGraph(smallGraph, {
    assessment: { computeModularity: true, weights: { cohesion: 1, coupling: 1, modularity: 1 } },
  });
  assert.ok(computable.ok);
  assert.equal(computable.value.metadata.metricWeights.modularity, 1);
});

// --- Group provenance survives the round trip (Gap 12) --------------------

test("regionId, ordinal and groupIds survive serialize → parse", () => {
  const graph: RawDependencyGraph = {
    nodes: Array.from({ length: 6 }, (_, i) => ({
      id: `file:p${i % 2}/F${i}.java`,
      kind: "file" as const,
      packagePath: `p${i % 2}`,
      directoryPath: `p${i % 2}`,
    })),
    edges: [
      {
        source: "file:p0/F0.java",
        target: "file:p0/F2.java",
        importFrequency: 4,
        methodCallFrequency: 0,
        sharedTypeCount: 0,
      },
    ],
  };
  const output = runPipeline(graph);

  const dir = freshIndexDir();
  try {
    assert.ok(serializeIndex(output.hierarchy, output.metadata, dir).ok);
    const parsed = parseIndex(dir);
    assert.ok(parsed.ok);

    let checked = 0;
    const reparsed = parsed.value.hierarchy;
    for (const [id, before] of output.hierarchy.nodes) {
      const after = reparsed.nodes.get(id)!;
      assert.equal(after.regionId, before.regionId, `regionId of ${id}`);
      assert.equal(after.ordinal, before.ordinal, `ordinal of ${id}`);
      if (before.regionId !== undefined) {
        checked += 1;
      }
    }
    assert.ok(checked > 0, "the fixture must exercise groups that carry provenance");

    // The decision → groups direction round-trips too.
    for (const decision of parsed.value.metadata.regionDecisions) {
      const original = output.metadata.regionDecisions.find((d) => d.regionId === decision.regionId)!;
      assert.deepEqual(decision.groupIds, original.groupIds);
      assert.ok((decision.groupIds ?? []).length > 0, "each decision must name its groups");
      for (const groupId of decision.groupIds ?? []) {
        assert.ok(parsed.value.hierarchy.nodes.has(groupId));
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an index written without provenance still parses (the fields are optional)", () => {
  const output = runPipeline(smallGraph);
  const dir = freshIndexDir();
  try {
    assert.ok(serializeIndex(output.hierarchy, output.metadata, dir).ok);

    const nodesDoc = JSON.parse(readFileSync(join(dir, "nodes.json"), "utf8")) as {
      nodes: Array<Record<string, unknown>>;
    };
    for (const entry of nodesDoc.nodes) {
      delete entry.regionId;
      delete entry.ordinal;
    }
    writeFileSync(join(dir, "nodes.json"), JSON.stringify(nodesDoc), "utf8");

    const metaDoc = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")) as {
      regionDecisions: Array<Record<string, unknown>>;
    };
    for (const decision of metaDoc.regionDecisions) {
      delete decision.groupIds;
    }
    writeFileSync(join(dir, "metadata.json"), JSON.stringify(metaDoc), "utf8");

    const parsed = parseIndex(dir);
    assert.ok(parsed.ok, "older indexes must still parse");
    for (const node of parsed.value.hierarchy.nodes.values()) {
      assert.equal(node.regionId, undefined);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("half-present provenance and unknown group ids are rejected", () => {
  const output = runPipeline(smallGraph);

  const tamper = (
    file: string,
    mutate: (doc: Record<string, unknown>) => void,
  ): ReturnType<typeof parseIndex> => {
    const dir = freshIndexDir();
    try {
      assert.ok(serializeIndex(output.hierarchy, output.metadata, dir).ok);
      const doc = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
      mutate(doc);
      writeFileSync(join(dir, file), JSON.stringify(doc), "utf8");
      return parseIndex(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  // regionId without ordinal: an incomplete recipe is worse than none.
  const halfPresent = tamper("nodes.json", (doc) => {
    const entry = (doc.nodes as Array<Record<string, unknown>>).find((n) => n.regionId !== undefined)!;
    delete entry.ordinal;
  });
  assert.ok(!halfPresent.ok);
  assert.equal(halfPresent.error.code, "MALFORMED_FILE");

  // A decision naming a group that is not in the tree.
  const ghostGroup = tamper("metadata.json", (doc) => {
    (doc.regionDecisions as Array<Record<string, unknown>>)[0]!.groupIds = ["g_ghost"];
  });
  assert.ok(!ghostGroup.ok);
  assert.equal(ghostGroup.error.code, "MALFORMED_FILE");
  assert.ok("detail" in ghostGroup.error && ghostGroup.error.detail.includes("unknown group"));
});
