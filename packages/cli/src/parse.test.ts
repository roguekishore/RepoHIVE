/**
 * Tests for the parse command's hardened argument surface.
 *
 * The command it replaces had no argument tests at all, because it had no
 * argument surface worth testing: it filtered positionals by "starts with --",
 * never rejected an unknown flag, and fell back to a fixture when given
 * nothing. Each of those is asserted against here.
 *
 * The parse function is injected, so these run without a Java project; the
 * real pipeline is covered end to end by running the built binary.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParseOptions } from "@repohive/parser";
import { main, parseParseArgs, type ParseRunner } from "./parse.js";

function captureIo(): { io: { log(m: string): void; error(m: string): void }; out: string[]; errs: string[] } {
  const out: string[] = [];
  const errs: string[] = [];
  return { io: { log: (m) => out.push(m), error: (m) => errs.push(m) }, out, errs };
}

function soleJsonDocument(out: readonly string[]): Record<string, unknown> {
  assert.equal(out.length, 1, `expected one stdout document, got ${out.length}`);
  return JSON.parse(out[0]!) as Record<string, unknown>;
}

/** A parse function that records its options and reports a fixed success. */
function recordingRunner(): { run: ParseRunner; seen: ParseOptions[] } {
  const seen: ParseOptions[] = [];
  const run: ParseRunner = async (options) => {
    seen.push(options);
    return {
      ok: true,
      value: {
        outputPath: options.outputPath ?? join(options.projectDirectory, "graph.json"),
        nodeCount: 29,
        edgeCount: 40,
        excludedDirectoryCount: 3,
      },
    };
  };
  return { run, seen };
}

/** A parse function that always fails, the way the parser reports failure. */
const failingRunner: ParseRunner = async () => ({
  ok: false,
  errors: [{ reason: "no-java-files", message: "no .java files were found", path: "/nowhere" }],
});

/** A directory that exists, so argument handling is what is under test. */
function tempDirectory(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), "repohive-parse-cli-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("no directory is a usage error, not a run against a bundled fixture", async () => {
  const { io, out, errs } = captureIo();
  const { run, seen } = recordingRunner();
  assert.equal(await main([], io, run), 2);
  assert.equal(seen.length, 0, "nothing may be parsed when no target was given");
  assert.equal(out.length, 0);
  assert.ok(errs.some((line) => line.includes("a project directory is required")));
});

test("--help prints usage and exits zero", async () => {
  const { io, out } = captureIo();
  assert.equal(await main(["--help"], io, recordingRunner().run), 0);
  assert.ok(out.some((line) => line.includes("--include-generated")));
  assert.ok(out.some((line) => line.includes("no default project directory")));
});

test("unknown flags, missing values and extra positionals are rejected", async () => {
  for (const argv of [["dir", "--bogus"], ["dir", "-x"], ["a", "b"], ["dir", "--out"]]) {
    const { io, errs } = captureIo();
    const { run, seen } = recordingRunner();
    assert.equal(await main(argv, io, run), 2, argv.join(" "));
    assert.equal(seen.length, 0, "a rejected command line must not reach the parser");
    assert.ok(errs.length > 0);
  }

  const unknown = parseParseArgs(["dir", "--bogus"]);
  assert.ok(!unknown.ok && unknown.message.includes("unknown option"));

  const extra = parseParseArgs(["a", "b"]);
  assert.ok(!extra.ok && extra.message.includes("extra argument"));

  // The old positional filter dropped anything starting with "--" and read the
  // rest in order, so this parsed as "project dir, output path".
  const looksPositional = parseParseArgs(["dir", "out"]);
  assert.ok(!looksPositional.ok, "--out is the only way to redirect output");
});

test("--exclude splits and trims, and cannot be combined with --include-generated", () => {
  const parsed = parseParseArgs(["dir", "--exclude", " vendor , testdata "]);
  assert.ok(parsed.ok && "value" in parsed);
  assert.deepEqual(parsed.value.extraExcludes, ["vendor", "testdata"]);

  const empty = parseParseArgs(["dir", "--exclude", " , "]);
  assert.ok(!empty.ok && empty.message.includes("at least one"));

  const combined = parseParseArgs(["dir", "--include-generated", "--exclude", "vendor"]);
  assert.ok(!combined.ok, "silently ignoring one of two exclusion flags is the bug being fixed");
});

test("a nonexistent directory is a usage error and creates nothing", async () => {
  const missing = join(tmpdir(), "repohive-parse-does-not-exist");
  const { io, errs } = captureIo();
  const { run, seen } = recordingRunner();
  assert.equal(await main([missing], io, run), 2);
  assert.equal(seen.length, 0);
  assert.ok(!existsSync(join(missing, ".repohive")), "a bad input must not fabricate directories");
  assert.ok(errs.some((line) => line.includes("path not found")));
});

test("output defaults to <dir>/.repohive/graph.json and --out redirects it", async () => {
  const project = tempDirectory();
  const target = tempDirectory();
  try {
    const { run, seen } = recordingRunner();
    const { io } = captureIo();
    assert.equal(await main([project.dir], io, run), 0);
    assert.equal(seen[0]?.outputPath, join(project.dir, ".repohive", "graph.json"));
    assert.ok(existsSync(join(project.dir, ".repohive")));

    const out = join(target.dir, "elsewhere");
    assert.equal(await main([project.dir, "--out", out], io, run), 0);
    assert.equal(seen[1]?.outputPath, join(out, "graph.json"));
    assert.ok(existsSync(out), "the output directory is created for the parser");
  } finally {
    project.cleanup();
    target.cleanup();
  }
});

test("the exclusion flags reach the parser as the parser's three-way instruction", async () => {
  const project = tempDirectory();
  try {
    const { run, seen } = recordingRunner();
    const { io } = captureIo();

    assert.equal(await main([project.dir], io, run), 0);
    assert.equal(seen[0]?.excludedSegments, undefined, "undefined means the default list");

    assert.equal(await main([project.dir, "--include-generated"], io, run), 0);
    assert.equal(seen[1]?.excludedSegments?.size, 0, "empty means include everything");

    assert.equal(await main([project.dir, "--exclude", "vendor"], io, run), 0);
    assert.ok(seen[2]?.excludedSegments?.has("vendor"));
    assert.ok(seen[2]?.excludedSegments?.has("node_modules"), "added to the default list");
  } finally {
    project.cleanup();
  }
});

test("--json reports the parse counts and writes nothing to stderr", async () => {
  const project = tempDirectory();
  try {
    const { io, out, errs } = captureIo();
    assert.equal(await main([project.dir, "--json"], io, recordingRunner().run), 0);
    assert.equal(errs.length, 0, "a --json run writes only to stdout");

    const document = soleJsonDocument(out);
    assert.equal(document["schemaVersion"], 1);
    assert.equal(document["command"], "parse");
    assert.equal(document["ok"], true);

    const result = document["result"] as Record<string, unknown>;
    assert.equal(result["outputDirectory"], join(project.dir, ".repohive"));
    assert.equal(result["graphPath"], join(project.dir, ".repohive", "graph.json"));
    assert.equal(result["nodeCount"], 29);
    assert.equal(result["edgeCount"], 40);
    assert.equal(result["excludedDirectoryCount"], 3);
    assert.ok(!("crossScopeAmbiguities" in result), "omitted, not defaulted to zero");
    assert.equal(typeof (result["durationMs"] as Record<string, number>)["total"], "number");
  } finally {
    project.cleanup();
  }
});

test("a failed parse exits 1 and carries the parser's own error list", async () => {
  const project = tempDirectory();
  try {
    const prose = captureIo();
    assert.equal(await main([project.dir], prose.io, failingRunner), 1);
    assert.equal(prose.out.length, 0, "a failure is not printed as a result");
    assert.ok(prose.errs.some((line) => line.includes("no-java-files")));

    const json = captureIo();
    assert.equal(await main([project.dir, "--json"], json.io, failingRunner), 1);
    const document = soleJsonDocument(json.out);
    assert.equal(document["ok"], false);
    assert.equal(document["stage"], "parse");
    assert.equal(document["command"], "parse");
    const errors = document["errors"] as Record<string, unknown>[];
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.["reason"], "no-java-files");
    assert.equal(json.errs.length, 0);
  } finally {
    project.cleanup();
  }
});
