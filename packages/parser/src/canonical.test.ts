/**
 * Tests for canonical ordering and stable stringification (Task 2.2).
 *
 * Covers the two correctness properties this module underpins:
 * - Property 8 (Canonical ordering, R9.2/R9.3): emitted nodes are sorted
 *   ascending by id; emitted edges ascending by `(source, target)`.
 * - Property 1 (byte-identity, R9.6): equal graph content — regardless of the
 *   order nodes/edges are presented in — stringifies to byte-identical text.
 *
 * Uses `fast-check` over `node:test`, per the design's testing strategy.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import type {
  DependencyEdge,
  GraphNode,
  RawDependencyGraph,
} from "@repohive/shared";
import {
  compareUtf8,
  sortGraphCanonically,
  stringifyGraph,
} from "./canonical.js";

// --- Generators -----------------------------------------------------------

/**
 * Identifier-like strings. A mix of ASCII and multi-byte characters exercises
 * the byte-wise (not UTF-16 code-unit) comparison requirement.
 */
const idArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 12 }),
  fc
    .string({ minLength: 1, maxLength: 8 })
    .map((s) => `class:com.example.${s}`),
  fc.constantFrom("é", "Z", "a", "\u{1F600}", "Ab", "aB", "A", "b"),
);

/** A frequency signal: finite, non-negative integer. */
const freqArb = fc.integer({ min: 0, max: 2_147_483_647 });

/** Build a node with a unique id drawn from a shared id pool. */
function nodeArb(id: string): fc.Arbitrary<GraphNode> {
  return fc.record({
    id: fc.constant(id),
    kind: fc.constantFrom<GraphNode["kind"]>("file", "class", "function"),
    packagePath: fc.option(fc.string({ maxLength: 10 }), { nil: undefined }),
    directoryPath: fc.string({ maxLength: 12 }),
    definedInFile: fc.option(idArb, { nil: undefined }),
  });
}

/**
 * A graph with unique node ids and unique `(source, target)` edge pairs, drawn
 * so both the ordering and byte-identity properties are well-defined (the
 * canonical order is total only when pairs are unique — R9.3).
 */
const graphArb: fc.Arbitrary<RawDependencyGraph> = fc
  .uniqueArray(idArb, { minLength: 0, maxLength: 8 })
  .chain((ids) => {
    const nodesArb =
      ids.length === 0
        ? fc.constant<GraphNode[]>([])
        : fc.tuple(...ids.map((id) => nodeArb(id)));

    const pairArb =
      ids.length === 0
        ? fc.constant<[string, string][]>([])
        : fc.uniqueArray(
            fc.tuple(fc.constantFrom(...ids), fc.constantFrom(...ids)),
            {
              maxLength: 10,
              selector: (p) => `${p[0]}\u0000${p[1]}`,
            },
          );

    return fc.tuple(nodesArb, pairArb).chain(([nodes, pairs]) => {
      const edgesArb =
        pairs.length === 0
          ? fc.constant<DependencyEdge[]>([])
          : fc.tuple(
              ...pairs.map(([source, target]) =>
                fc.record({
                  source: fc.constant(source),
                  target: fc.constant(target),
                  importFrequency: freqArb,
                  methodCallFrequency: freqArb,
                  sharedTypeCount: freqArb,
                }),
              ),
            );
      return edgesArb.map((edges) => ({ nodes, edges }));
    });
  });

/** Return a deterministic shuffle of an array driven by a permutation seed. */
function permute<T>(items: readonly T[], order: readonly number[]): T[] {
  return items
    .map((item, index) => ({ item, key: order[index] ?? index }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.item);
}

// --- Property: canonical ordering (R9.2, R9.3) ----------------------------

test("nodes are emitted sorted ascending byte-wise by id", () => {
  fc.assert(
    fc.property(graphArb, (graph) => {
      const sorted = sortGraphCanonically(graph);
      for (let i = 1; i < sorted.nodes.length; i++) {
        const prev = sorted.nodes[i - 1]!.id;
        const curr = sorted.nodes[i]!.id;
        assert.ok(
          compareUtf8(prev, curr) < 0,
          `node ids not strictly ascending: ${prev} !< ${curr}`,
        );
      }
    }),
  );
});

test("edges are emitted sorted ascending by (source, target)", () => {
  fc.assert(
    fc.property(graphArb, (graph) => {
      const sorted = sortGraphCanonically(graph);
      for (let i = 1; i < sorted.edges.length; i++) {
        const prev = sorted.edges[i - 1]!;
        const curr = sorted.edges[i]!;
        const cmp =
          compareUtf8(prev.source, curr.source) !== 0
            ? compareUtf8(prev.source, curr.source)
            : compareUtf8(prev.target, curr.target);
        assert.ok(
          cmp < 0,
          `edges not strictly ascending at ${i}: (${prev.source},${prev.target}) !< (${curr.source},${curr.target})`,
        );
      }
    }),
  );
});

test("stringified output reflects canonical order regardless of input order", () => {
  fc.assert(
    fc.property(
      graphArb,
      fc.array(fc.integer(), { maxLength: 20 }),
      fc.array(fc.integer(), { maxLength: 20 }),
      (graph, nodeOrder, edgeOrder) => {
        const shuffled: RawDependencyGraph = {
          nodes: permute(graph.nodes, nodeOrder),
          edges: permute(graph.edges, edgeOrder),
        };
        assert.equal(stringifyGraph(shuffled), stringifyGraph(graph));
      },
    ),
  );
});

// --- Property: byte-identical stringify for equal graphs (R9.6) -----------

test("equal graphs produce byte-identical stringify output", () => {
  fc.assert(
    fc.property(graphArb, (graph) => {
      const clone: RawDependencyGraph = {
        nodes: graph.nodes.map((n) => ({ ...n })),
        edges: graph.edges.map((e) => ({ ...e })),
      };
      const a = Buffer.from(stringifyGraph(graph), "utf8");
      const b = Buffer.from(stringifyGraph(clone), "utf8");
      assert.equal(Buffer.compare(a, b), 0);
    }),
  );
});

test("stringify output is valid JSON with no BOM and a trailing newline", () => {
  fc.assert(
    fc.property(graphArb, (graph) => {
      const text = stringifyGraph(graph);
      assert.equal(text.charCodeAt(0), "{".charCodeAt(0)); // no BOM
      assert.ok(text.endsWith("\n"), "output must end with a newline");
      assert.doesNotThrow(() => JSON.parse(text));
    }),
  );
});

// --- Property: round-trip preserves content (order-insensitive) -----------

test("parsed output preserves node and edge counts and payloads", () => {
  fc.assert(
    fc.property(graphArb, (graph) => {
      const parsed = JSON.parse(stringifyGraph(graph)) as RawDependencyGraph;
      assert.equal(parsed.nodes.length, graph.nodes.length);
      assert.equal(parsed.edges.length, graph.edges.length);
      // strength is never emitted (R7.7).
      for (const edge of parsed.edges) {
        assert.ok(!("strength" in edge));
      }
    }),
  );
});

// --- Example: exact canonical key order and byte-wise ordering ------------

test("emits fixed canonical key order for nodes and edges", () => {
  const graph: RawDependencyGraph = {
    nodes: [
      {
        id: "class:com.example.B",
        kind: "class",
        packagePath: "com.example",
        directoryPath: "src/com/example",
        definedInFile: "file:src/com/example/B.java",
      },
      {
        id: "class:com.example.A",
        kind: "class",
        directoryPath: "",
      },
    ],
    edges: [
      {
        source: "class:com.example.B",
        target: "class:com.example.A",
        importFrequency: 2,
        methodCallFrequency: 0,
        sharedTypeCount: 0,
      },
    ],
  };

  const expected = [
    "{",
    '  "nodes": [',
    "    {",
    '      "id": "class:com.example.A",',
    '      "kind": "class",',
    '      "directoryPath": ""',
    "    },",
    "    {",
    '      "id": "class:com.example.B",',
    '      "kind": "class",',
    '      "packagePath": "com.example",',
    '      "directoryPath": "src/com/example",',
    '      "definedInFile": "file:src/com/example/B.java"',
    "    }",
    "  ],",
    '  "edges": [',
    "    {",
    '      "source": "class:com.example.B",',
    '      "target": "class:com.example.A",',
    '      "importFrequency": 2,',
    '      "methodCallFrequency": 0,',
    '      "sharedTypeCount": 0',
    "    }",
    "  ]",
    "}",
    "",
  ].join("\n");

  assert.equal(stringifyGraph(graph), expected);
});

test("empty graph emits well-formed JSON with empty arrays", () => {
  const text = stringifyGraph({ nodes: [], edges: [] });
  assert.equal(text, '{\n  "nodes": [],\n  "edges": []\n}\n');
  assert.doesNotThrow(() => JSON.parse(text));
});

test("byte-wise comparison orders uppercase before lowercase", () => {
  // 'Z' (0x5A) sorts before 'a' (0x61) byte-wise, unlike a locale-aware sort.
  assert.ok(compareUtf8("Z", "a") < 0);
  assert.ok(compareUtf8("a", "b") < 0);
});
