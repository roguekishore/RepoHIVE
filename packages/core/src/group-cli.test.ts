/**
 * Tests for the group CLI's argument surface (Gap 20).
 *
 * `group-cli` accepted exactly two positionals and passed no config, so every
 * run used DEFAULT_GROUPING_CONFIG — and Req 4.4 requires the boundary to be
 * varied across runs *without code changes* so a sensitivity analysis can be
 * run. Extra positionals were silently ignored, which would turn a typo in a
 * sweep into a default-parameter run that looks successful.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RawDependencyGraph } from "@repohive/shared";
import { main, parseGroupArgs } from "./group-cli.js";
import { parseIndex } from "./index-parser.js";

/** Collect CLI output instead of writing to the console. */
function captureIo(): { io: { log(m: string): void; error(m: string): void }; out: string[]; errs: string[] } {
  const out: string[] = [];
  const errs: string[] = [];
  return { io: { log: (m) => out.push(m), error: (m) => errs.push(m) }, out, errs };
}

const graph: RawDependencyGraph = {
  nodes: [
    { id: "file:p/A.java", kind: "file", packagePath: "p", directoryPath: "p" },
    { id: "file:p/B.java", kind: "file", packagePath: "p", directoryPath: "p" },
    { id: "file:q/C.java", kind: "file", packagePath: "q", directoryPath: "q" },
  ],
  edges: [
    {
      source: "file:p/A.java",
      target: "file:p/B.java",
      importFrequency: 5,
      methodCallFrequency: 0,
      sharedTypeCount: 0,
    },
  ],
};

/** A temp project directory holding `graph.json`, plus a cleanup handle. */
function tempProject(fileName = "graph.json"): { dir: string; graphPath: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), "repohive-cli-"));
  const graphPath = join(dir, fileName);
  writeFileSync(graphPath, JSON.stringify(graph), "utf8");
  return { dir, graphPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// --- Argument parsing ------------------------------------------------------

test("no arguments is a usage error, not a default run", () => {
  const { io, errs } = captureIo();
  assert.equal(main([], io), 2);
  assert.ok(errs.some((line) => line.includes("input path is required")));
  assert.ok(errs.some((line) => line.includes("usage:")));
});

test("--help prints usage and exits zero", () => {
  const { io, out } = captureIo();
  assert.equal(main(["--help"], io), 0);
  assert.ok(out.some((line) => line.includes("--boundary")));
});

test("unknown flags and extra positionals are rejected", () => {
  for (const argv of [["in", "--bogus"], ["in", "-x"], ["a", "b", "c"]]) {
    const { io, errs } = captureIo();
    assert.equal(main(argv, io), 2, argv.join(" "));
    assert.ok(errs.length > 0);
  }

  const unknown = parseGroupArgs(["in", "--bogus"]);
  assert.ok(!unknown.ok && unknown.message.includes("unknown option"));

  const extra = parseGroupArgs(["a", "b", "c"]);
  assert.ok(!extra.ok && extra.message.includes("extra argument"));
});

test("a flag with a missing or non-numeric value is a usage error", () => {
  const missing = parseGroupArgs(["in", "--boundary"]);
  assert.ok(!missing.ok && missing.message.includes("numeric value"));

  const swallowed = parseGroupArgs(["in", "--boundary", "--seed", "1"]);
  assert.ok(!swallowed.ok, "a following flag must not be consumed as a value");

  const nonNumeric = parseGroupArgs(["in", "--boundary", "high"]);
  assert.ok(!nonNumeric.ok && nonNumeric.message.includes("finite number"));

  const nan = parseGroupArgs(["in", "--seed", "NaN"]);
  assert.ok(!nan.ok, "NaN must be caught at the flag, before the config");

  const outMissing = parseGroupArgs(["in", "--out"]);
  assert.ok(!outMissing.ok && outMissing.message.includes("requires a value"));
});

test("every flag reaches the resolved config", () => {
  const parsed = parseGroupArgs([
    "graph.json",
    "--boundary", "0.25",
    "--seed", "7",
    "--max-group-size", "12",
    "--min-partition-threshold", "3",
    "--weight-cohesion", "2",
    "--weight-coupling", "3",
    "--weight-modularity", "4",
    "--squash-k", "5",
    "--degenerate-score", "0.75",
    "--compute-modularity",
    "--out", "somewhere",
  ]);
  assert.ok(parsed.ok && "value" in parsed);
  const { input, outDir, config } = parsed.value;

  assert.equal(input, "graph.json");
  assert.equal(outDir, "somewhere");
  assert.equal(config.structuralQualityBoundary, 0.25);
  assert.equal(config.communityDetectionSeed, 7);
  assert.equal(config.hierarchy?.maxGroupSize, 12);
  assert.equal(config.hierarchy?.minPartitionThreshold, 3);
  assert.equal(config.assessment?.weights?.cohesion, 2);
  assert.equal(config.assessment?.weights?.coupling, 3);
  assert.equal(config.assessment?.weights?.modularity, 4);
  assert.equal(config.assessment?.cohesionSquashConstant, 5);
  assert.equal(config.assessment?.degenerateScore, 0.75);
  assert.equal(config.assessment?.computeModularity, true);
});

test("repeated --preserve/--reconstruct build the override map", () => {
  const parsed = parseGroupArgs([
    "graph.json",
    "--preserve", "pkg:a",
    "--reconstruct", "pkg:b",
    "--preserve", "pkg:c",
  ]);
  assert.ok(parsed.ok && "value" in parsed);
  assert.deepEqual(
    [...parsed.value.config.overrides!.entries()].sort(),
    [
      ["pkg:a", "preserve"],
      ["pkg:b", "reconstruct"],
      ["pkg:c", "preserve"],
    ],
  );

  // Repeating the same action for one region is harmless.
  const repeated = parseGroupArgs(["g", "--preserve", "pkg:a", "--preserve", "pkg:a"]);
  assert.ok(repeated.ok);
});

test("conflicting overrides for one region are rejected", () => {
  const conflict = parseGroupArgs(["g", "--preserve", "pkg:a", "--reconstruct", "pkg:a"]);
  assert.ok(!conflict.ok && conflict.message.includes("conflicting"));
});

// --- End-to-end behaviour --------------------------------------------------

test("the boundary flag actually changes the decisions — Req 4.4 without code changes", () => {
  const project = tempProject();
  try {
    const runAt = (boundary: string): string[] => {
      const outDir = join(project.dir, `index-${boundary}`);
      const { io, out } = captureIo();
      assert.equal(main([project.graphPath, outDir, "--boundary", boundary], io), 0);
      const parsed = parseIndex(outDir);
      assert.ok(parsed.ok);
      return parsed.value.metadata.regionDecisions.map((d) => d.action);
    };

    // Boundary 0 preserves everywhere; a boundary above every score
    // reconstructs everywhere. Same input, different hierarchies, no code edit.
    assert.ok(runAt("0").every((action) => action === "preserve"));
    assert.ok(runAt("1.000001").every((action) => action === "reconstruct"));
  } finally {
    project.cleanup();
  }
});

test("an invalid parameter is rejected through validateConfig and writes nothing", () => {
  const project = tempProject();
  try {
    const outDir = join(project.dir, "index");
    const { io, errs } = captureIo();
    // Legal as a number, illegal as a config value — the CLI must not become a
    // second injection route for what Gap 9's gate rejects.
    assert.equal(main([project.graphPath, outDir, "--squash-k", "0"], io), 1);
    assert.ok(errs.some((line) => line.includes("cohesionSquashConstant")));
    assert.ok(!readdirSync(project.dir).includes("index"));
  } finally {
    project.cleanup();
  }
});

test("a directory without graph.json reports not-found, not malformed", () => {
  const dir = mkdtempSync(join(tmpdir(), "repohive-cli-empty-"));
  try {
    const { io, errs } = captureIo();
    assert.equal(main([dir], io), 1);
    const message = errs.join("\n");
    assert.ok(message.includes("not found"), message);
    assert.ok(!message.includes("malformed"), "a missing file is not a malformed one");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an input file not ending in .json still gets a sibling index directory", () => {
  const project = tempProject("dependency-graph");
  try {
    const { io, out } = captureIo();
    assert.equal(main([project.graphPath], io), 0);
    // Derived from the file's directory, so never a path *under* the file.
    assert.ok(out.some((line) => line.includes(join(project.dir, "index"))));
    assert.ok(parseIndex(join(project.dir, "index")).ok);
  } finally {
    project.cleanup();
  }
});

test("a nonexistent input path exits 2 without touching the filesystem", () => {
  const { io, errs } = captureIo();
  assert.equal(main([join(tmpdir(), "repohive-does-not-exist-at-all")], io), 2);
  assert.ok(errs.some((line) => line.includes("path not found")));
});
