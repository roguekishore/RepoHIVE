/**
 * Asynchronous grouping and output (hosting-1 Requirements 7 and 8): the index
 * files are written concurrently, sub-stages are reported as they begin, the
 * event loop gets a turn between them, and none of it changes a byte.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RawDependencyGraph } from "@repohive/shared";
import {
  groupGraph,
  groupGraphToIndex,
  groupGraphToIndexAsync,
  type GroupingSubstage,
} from "./orchestrator.js";
import {
  INDEX_FILE_NAMES,
  serializeIndexAsync,
  type IndexSerializerAsyncDeps,
} from "./index-serializer.js";

const graph: RawDependencyGraph = {
  nodes: [
    { id: "file:p/A.java", kind: "file", packagePath: "p", directoryPath: "p" },
    { id: "file:p/B.java", kind: "file", packagePath: "p", directoryPath: "p" },
    { id: "file:q/C.java", kind: "file", packagePath: "q", directoryPath: "q" },
  ],
  edges: [
    { source: "file:p/A.java", target: "file:p/B.java", importFrequency: 4, methodCallFrequency: 0, sharedTypeCount: 0 },
    { source: "file:p/A.java", target: "file:q/C.java", importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0 },
  ],
};

function readIndex(dir: string): Map<string, string> {
  return new Map(INDEX_FILE_NAMES.map((name) => [name, readFileSync(join(dir, name), "utf8")]));
}

function withTemp<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "repohive-async-"));
  return fn(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

test("the async path writes exactly the bytes the synchronous path writes", () =>
  withTemp(async (root) => {
    assert.ok(groupGraphToIndex(graph, join(root, "sync")).ok);
    const result = await groupGraphToIndexAsync(graph, join(root, "async"));
    assert.ok(result.ok);
    assert.deepEqual(readIndex(join(root, "async")), readIndex(join(root, "sync")));
    assert.deepEqual(readdirSync(root).sort(), ["async", "sync"], "no staging directory is left behind");
    const plain = groupGraph(graph);
    assert.ok(plain.ok);
    assert.deepEqual(result.value.metadata, plain.value.metadata);
  }));

test("every sub-stage is reported once, in order, before it runs", () =>
  withTemp(async (root) => {
    const seen: GroupingSubstage[] = [];
    const result = await groupGraphToIndexAsync(graph, join(root, "index"), undefined, {
      onProgress: (event) => seen.push(event.substage),
    });
    assert.ok(result.ok);
    assert.deepEqual(seen, ["ingest", "weight", "assess", "construct", "hierarchy", "metadata", "write"]);
  }));

test("work a progress callback schedules runs before the grouping finishes", () =>
  withTemp(async (root) => {
    // The callback fires as ingest is about to begin and schedules a macrotask.
    // It must run before the next sub-stage is announced, i.e. long before the
    // grouping returns, which a synchronous pipeline could not allow.
    let scheduledRanBeforeNextSubstage = false;
    let announcedAfterIngest = false;
    const result = await groupGraphToIndexAsync(graph, join(root, "index"), undefined, {
      onProgress: ({ substage }) => {
        if (substage === "ingest") {
          setImmediate(() => {
            scheduledRanBeforeNextSubstage = !announcedAfterIngest;
          });
        } else {
          announcedAfterIngest = true;
        }
      },
    });
    assert.ok(result.ok);
    assert.equal(scheduledRanBeforeNextSubstage, true);
  }));

test("a throwing progress callback is reported as INTERNAL_ERROR and writes nothing", () =>
  withTemp(async (root) => {
    const result = await groupGraphToIndexAsync(graph, join(root, "index"), undefined, {
      onProgress: ({ substage }) => {
        if (substage === "construct") {
          throw new Error("callback exploded");
        }
      },
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "INTERNAL_ERROR");
    assert.equal(existsSync(join(root, "index")), false);
  }));

test("a config error is returned before any sub-stage runs", () =>
  withTemp(async (root) => {
    const seen: GroupingSubstage[] = [];
    const result = await groupGraphToIndexAsync(
      graph,
      join(root, "index"),
      { structuralQualityBoundary: Number.NaN },
      { onProgress: (event) => seen.push(event.substage) },
    );
    assert.ok(!result.ok);
    assert.equal(result.error.code, "INVALID_CONFIG");
    assert.deepEqual(seen, []);
  }));

/** Real-filesystem async deps with hooks to observe or break the writes. */
function asyncDeps(overrides: Partial<IndexSerializerAsyncDeps> = {}): IndexSerializerAsyncDeps {
  return {
    mkdir: async (p) => {
      await mkdir(p, { recursive: true });
    },
    writeChunks: async (p, chunks) => {
      await writeFile(p, [...chunks].join(""), "utf8");
    },
    rename: (from, to) => rename(from, to),
    rm: (p) => rm(p, { recursive: true, force: true }),
    exists: async (p) => existsSync(p),
    assertWritable: async () => undefined,
    ...overrides,
  };
}

test("the five files are in flight at the same time", () =>
  withTemp(async (root) => {
    const output = groupGraph(graph);
    assert.ok(output.ok);
    let inFlight = 0;
    let peak = 0;
    const result = await serializeIndexAsync(
      output.value.hierarchy,
      output.value.metadata,
      join(root, "index"),
      asyncDeps({
        writeChunks: async (p, chunks) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          // Hold every write open until all of them have started.
          await new Promise((resolve) => setTimeout(resolve, 20));
          await writeFile(p, [...chunks].join(""), "utf8");
          inFlight -= 1;
        },
      }),
    );
    assert.ok(result.ok);
    assert.equal(peak, INDEX_FILE_NAMES.length);
  }));

test("a failed write leaves no partial file at the final path and waits for the other writes", () =>
  withTemp(async (root) => {
    const output = groupGraph(graph);
    assert.ok(output.ok);
    let finished = 0;
    let started = 0;
    const dir = join(root, "index");
    const result = await serializeIndexAsync(
      output.value.hierarchy,
      output.value.metadata,
      dir,
      asyncDeps({
        writeChunks: async (p, chunks) => {
          started += 1;
          if (started === 2) {
            throw new Error("injected write failure");
          }
          await new Promise((resolve) => setTimeout(resolve, 30));
          await writeFile(p, [...chunks].join(""), "utf8");
          finished += 1;
        },
      }),
    );
    assert.ok(!result.ok);
    assert.equal(result.error.code, "WRITE_FAILED");
    assert.equal(finished, INDEX_FILE_NAMES.length - 1, "the surviving writes settled before cleanup");
    assert.equal(existsSync(dir), false);
    assert.deepEqual(readdirSync(root), [], "no staging leftovers");
  }));
