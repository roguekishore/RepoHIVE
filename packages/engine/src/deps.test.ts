/**
 * Tests for {@link defaultEngineDeps}: the stage functions must be the real
 * package entry points (identity, not lookalikes), and the filesystem/clock
 * collaborators must behave.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseProject } from "@repohive/parser";
import { readGraphFile } from "@repohive/core";

import { defaultEngineDeps } from "./orchestrator.js";

test("the default parse and read stages are the real parser and core entry points", () => {
  const deps = defaultEngineDeps();
  assert.equal(deps.parse, parseProject);
  assert.equal(deps.readGraph, readGraphFile);
});

test("the default group stage is core's asynchronous grouping: it returns a promise and writes the index", async () => {
  const deps = defaultEngineDeps();
  const dir = mkdtempSync(join(tmpdir(), "repohive-engine-deps-group-"));
  try {
    const substages: string[] = [];
    const pending = deps.group(
      {
        nodes: [
          { id: "file:p/A.java", kind: "file", packagePath: "p", directoryPath: "p" },
          { id: "file:p/B.java", kind: "file", packagePath: "p", directoryPath: "p" },
        ],
        edges: [
          { source: "file:p/A.java", target: "file:p/B.java", importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0 },
        ],
      },
      join(dir, "index"),
      undefined,
      ({ substage }) => substages.push(substage),
    );
    assert.ok(pending instanceof Promise);
    const result = await pending;
    assert.ok(result.ok);
    assert.ok(existsSync(join(dir, "index", "hierarchy.json")));
    assert.equal(substages[0], "ingest");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isDirectory reports directories, and not files or missing paths", () => {
  const deps = defaultEngineDeps();
  const dir = mkdtempSync(join(tmpdir(), "repohive-engine-deps-"));
  try {
    const file = join(dir, "a.txt");
    writeFileSync(file, "x", "utf8");

    assert.equal(deps.isDirectory(dir), true);
    assert.equal(deps.isDirectory(file), false);
    assert.equal(deps.isDirectory(join(dir, "missing")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureDirectory creates nested directories and is idempotent", () => {
  const deps = defaultEngineDeps();
  const dir = mkdtempSync(join(tmpdir(), "repohive-engine-deps-"));
  try {
    const nested = join(dir, "a", "b", ".repohive");
    deps.ensureDirectory(nested);
    assert.equal(existsSync(nested), true);
    // Second call over an existing directory must not throw.
    deps.ensureDirectory(nested);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("now is a finite, non-decreasing monotonic clock", () => {
  const deps = defaultEngineDeps();
  const first = deps.now();
  const second = deps.now();
  assert(Number.isFinite(first));
  assert(Number.isFinite(second));
  assert(second >= first, "the clock must never run backwards");
});
