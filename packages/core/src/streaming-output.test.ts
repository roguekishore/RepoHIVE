/**
 * Streaming output: the index is rendered and written
 * as chunks, never as a whole-artifact string, and the bytes are exactly what
 * the one-string renderer produces.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import fc from "fast-check";
import { CHUNK_MAX_LENGTH, coalesceChunks, type DependencyEdge, type GraphNode } from "@repohive/shared";
import { compactStringify, compactStringifyPieces, stableStringify, stableStringifyPieces } from "./canonical.js";
import { INDEX_FILE_NAMES, indexFilePayloads, serializeIndex, type IndexSerializerDeps } from "./index-serializer.js";
import { groupGraph } from "./orchestrator.js";

const joined = (pieces: Iterable<string>): string => [...pieces].join("");

// --- Pieces equal the one-string renderer -----------------------------------

const jsonValue: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: "small" },
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc.string({ unit: "grapheme" }),
    fc.array(fc.oneof(tie("value"), fc.constant(undefined)), { maxLength: 4 }),
    fc.dictionary(fc.string({ maxLength: 6 }), fc.oneof(tie("value"), fc.constant(undefined)), { maxKeys: 4 }),
  ),
})).value;

test("stableStringifyPieces concatenates to exactly stableStringify", () => {
  fc.assert(
    fc.property(jsonValue, (value) => {
      assert.equal(joined(stableStringifyPieces(value)), stableStringify(value));
    }),
    { numRuns: 300 },
  );
});

test("compactStringifyPieces concatenates to exactly compactStringify, which is the minified stableStringify", () => {
  fc.assert(
    fc.property(jsonValue, (value) => {
      assert.equal(joined(compactStringifyPieces(value)), compactStringify(value));
      // Same values, same key order: only the whitespace differs.
      assert.deepEqual(JSON.parse(compactStringify(value)), JSON.parse(stableStringify(value)));
    }),
    { numRuns: 300 },
  );
});

test("compactStringify has no whitespace between tokens and ends in one newline", () => {
  assert.equal(compactStringify({ b: [1, { c: "x y" }], a: null, d: [], e: {} }), '{"a":null,"b":[1,{"c":"x y"}],"d":[],"e":{}}\n');
  assert.equal(compactStringify([undefined, 1]), "[null,1]\n");
  assert.throws(() => compactStringify({ a: Number.NaN }), /non-finite/);
});

test("stableStringifyPieces handles empty containers and top-level scalars", () => {
  for (const value of [[], {}, { a: [], b: {} }, [[], {}], "x", 1, null, { a: undefined }]) {
    assert.equal(joined(stableStringifyPieces(value)), stableStringify(value));
  }
});

test("stableStringifyPieces rejects a non-finite number the way stableStringify does", () => {
  assert.throws(() => joined(stableStringifyPieces({ a: [Number.NaN] })), /non-finite/);
});

test("stableStringifyPieces is restartable: two calls give the same text", () => {
  const value = { b: [1, 2, { c: "x" }], a: "y" };
  assert.equal(joined(stableStringifyPieces(value)), joined(stableStringifyPieces(value)));
});

// --- Chunk sizing ------------------------------------------------------------

test("coalesceChunks preserves the text and never grows a chunk past the cap by joining", () => {
  const pieces = Array.from({ length: 5000 }, (_, i) => `piece-${i}-${"x".repeat(i % 700)}\n`);
  const chunks = [...coalesceChunks(pieces)];
  assert.equal(chunks.join(""), pieces.join(""));
  assert.ok(chunks.length > 1, "a multi-megabyte input is split");
  for (const chunk of chunks) {
    assert.ok(chunk.length <= CHUNK_MAX_LENGTH, "no chunk exceeds the cap");
  }
});

test("coalesceChunks passes a single oversized piece through whole", () => {
  const huge = "y".repeat(CHUNK_MAX_LENGTH + 10);
  const chunks = [...coalesceChunks(["a", huge, "b"])];
  assert.deepEqual(chunks, ["a", huge, "b"]);
});

test("coalesceChunks drops empty pieces", () => {
  assert.deepEqual([...coalesceChunks(["", "a", "", "b", ""])], ["ab"]);
  assert.deepEqual([...coalesceChunks([])], []);
});

// --- serializeIndex writes chunks -------------------------------------------

/** A graph large enough that each index file spans several chunks. */
function largeGraph(): { nodes: GraphNode[]; edges: DependencyEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: DependencyEdge[] = [];
  for (let i = 0; i < 4000; i += 1) {
    const dir = `src/pkg${i % 40}`;
    nodes.push({
      id: `file:${dir}/Class${i}.java`,
      kind: "file",
      packagePath: `pkg${i % 40}`,
      directoryPath: dir,
    });
  }
  for (let i = 1; i < nodes.length; i += 1) {
    edges.push({
      source: (nodes[i] as GraphNode).id,
      target: (nodes[(i * 7) % i] as GraphNode).id,
      importFrequency: 1 + (i % 3),
      methodCallFrequency: i % 2,
      sharedTypeCount: 0,
    });
  }
  return { nodes, edges };
}

function recordingDeps(chunksByFile: Map<string, string[]>): IndexSerializerDeps {
  return {
    mkdirSync: (p) => mkdirSync(p, { recursive: true }),
    writeChunksSync: (p, chunks) => {
      const recorded: string[] = [];
      for (const chunk of chunks) {
        recorded.push(chunk);
      }
      chunksByFile.set(p.split(/[\\/]/).pop() as string, recorded);
      writeFileSync(p, recorded.join(""), "utf8");
    },
    renameSync: () => undefined,
    rmSync: () => undefined,
    existsSync: () => false,
    assertWritable: () => undefined,
  };
}

test("serializeIndex hands the writer chunks no larger than the cap, and they rebuild the file", () => {
  const grouped = groupGraph(largeGraph());
  assert.ok(grouped.ok);
  const { hierarchy, metadata } = grouped.value;
  const parent = mkdtempSync(join(tmpdir(), "repohive-chunks-"));
  try {
    const recorded = new Map<string, string[]>();
    const result = serializeIndex(hierarchy, metadata, join(parent, "index"), recordingDeps(recorded));
    assert.ok(result.ok);

    const payloads = indexFilePayloads(hierarchy, metadata);
    let sawMultiChunkFile = false;
    for (const name of INDEX_FILE_NAMES) {
      const chunks = recorded.get(name);
      assert.ok(chunks !== undefined && chunks.length > 0, `${name} was written`);
      if (chunks.length > 1) {
        sawMultiChunkFile = true;
      }
      for (const chunk of chunks) {
        assert.ok(chunk.length <= CHUNK_MAX_LENGTH, `${name}: chunk of ${chunk.length} exceeds the cap`);
      }
      assert.equal(chunks.join(""), compactStringify(payloads[name]), `${name} rebuilds byte for byte`);
    }
    assert.ok(sawMultiChunkFile, "the fixture is big enough to exercise multi-chunk files");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("serializeIndex through the real writer produces the one-string rendering", () => {
  const grouped = groupGraph(largeGraph());
  assert.ok(grouped.ok);
  const { hierarchy, metadata } = grouped.value;
  const parent = mkdtempSync(join(tmpdir(), "repohive-chunks-real-"));
  const dir = join(parent, "index");
  try {
    assert.ok(serializeIndex(hierarchy, metadata, dir).ok);
    const payloads = indexFilePayloads(hierarchy, metadata);
    for (const name of INDEX_FILE_NAMES) {
      assert.equal(readFileSync(join(dir, name), "utf8"), compactStringify(payloads[name]), name);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
