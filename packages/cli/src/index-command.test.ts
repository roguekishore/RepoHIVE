/**
 * Tests for the index command's argument surface and result rendering.
 *
 * The orchestration call is injected, so these assert what the CLI does with
 * an engine result rather than re-testing the engine, which has its own
 * suites. The real pipeline is covered end to end by running the built binary
 * against the fixture.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineOptions, EngineResult, EngineSuccess } from "@repohive/engine";
import { main, type IndexRunner } from "./index-command.js";

function captureIo(): { io: { log(m: string): void; error(m: string): void }; out: string[]; errs: string[] } {
  const out: string[] = [];
  const errs: string[] = [];
  return { io: { log: (m) => out.push(m), error: (m) => errs.push(m) }, out, errs };
}

function soleJsonDocument(out: readonly string[]): Record<string, unknown> {
  assert.equal(out.length, 1, `expected one stdout document, got ${out.length}`);
  return JSON.parse(out[0]!) as Record<string, unknown>;
}

const success: EngineSuccess = {
  outputDirectory: "/project/.repohive",
  graphPath: "/project/.repohive/graph.json",
  indexDirectory: "/project/.repohive/index",
  parseSkipped: false,
  durationMs: { parse: 21, group: 9, total: 30 },
  nodeCount: 29,
  edgeCount: 40,
  regionCount: 4,
  preserveCount: 0,
  reconstructCount: 4,
  hierarchyDepth: 4,
  excludedDirectoryCount: 3,
};

/** An orchestration call that records its options and reports a fixed run. */
function recordingRunner(result: EngineResult = { ok: true, value: success }): {
  run: IndexRunner;
  seen: EngineOptions[];
} {
  const seen: EngineOptions[] = [];
  const run: IndexRunner = async (options) => {
    seen.push(options);
    return result;
  };
  return { run, seen };
}

function tempDirectory(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), "repohive-index-cli-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("no directory is a usage error and nothing is orchestrated", async () => {
  const { io, errs } = captureIo();
  const { run, seen } = recordingRunner();
  assert.equal(await main([], io, run), 2);
  assert.equal(seen.length, 0);
  assert.ok(errs.some((line) => line.includes("a project directory is required")));
});

test("--help prints usage naming the artifacts it writes", async () => {
  const { io, out } = captureIo();
  assert.equal(await main(["--help"], io, recordingRunner().run), 0);
  const text = out.join("\n");
  assert.ok(text.includes("graph.json"), text);
  assert.ok(text.includes("--boundary"), "the grouping flags pass through");
});

test("unknown flags and a second positional are rejected", async () => {
  for (const argv of [["dir", "--bogus"], ["dir", "-x"], ["dir", "also-dir"], ["dir", "--boundary"]]) {
    const { io, errs } = captureIo();
    const { run, seen } = recordingRunner();
    assert.equal(await main(argv, io, run), 2, argv.join(" "));
    assert.equal(seen.length, 0, "a rejected command line must not reach the engine");
    assert.ok(errs.length > 0);
  }
});

test("a nonexistent directory is a usage error, not a failed run", async () => {
  const { io, errs } = captureIo();
  const { run, seen } = recordingRunner();
  assert.equal(await main([join(tmpdir(), "repohive-index-missing")], io, run), 2);
  assert.equal(seen.length, 0);
  assert.ok(errs.some((line) => line.includes("path not found")));
});

test("--out maps to outputDirectory and the tuning flags to grouping", async () => {
  const project = tempDirectory();
  try {
    const { run, seen } = recordingRunner();
    const { io } = captureIo();

    assert.equal(await main([project.dir], io, run), 0);
    assert.equal(seen[0]?.projectDirectory, project.dir);
    assert.equal(seen[0]?.outputDirectory, undefined, "the engine supplies the default root");
    assert.equal(seen[0]?.grouping, undefined, "an untuned run passes no config at all");

    assert.equal(
      await main([project.dir, "--out", "elsewhere", "--boundary", "0.25", "--seed", "7"], io, run),
      0,
    );
    assert.equal(seen[1]?.outputDirectory, join(process.cwd(), "elsewhere"));
    assert.equal(seen[1]?.grouping?.structuralQualityBoundary, 0.25);
    assert.equal(seen[1]?.grouping?.communityDetectionSeed, 7);
  } finally {
    project.cleanup();
  }
});

test("--json carries every engine result field, including parseSkipped", async () => {
  const project = tempDirectory();
  try {
    const { io, out, errs } = captureIo();
    assert.equal(await main([project.dir, "--json"], io, recordingRunner().run), 0);
    assert.equal(errs.length, 0, "a --json run writes only to stdout");

    const document = soleJsonDocument(out);
    assert.equal(document["schemaVersion"], 1);
    assert.equal(document["command"], "index");
    assert.equal(document["ok"], true);

    const result = document["result"] as Record<string, unknown>;
    assert.equal(result["outputDirectory"], success.outputDirectory);
    assert.equal(result["graphPath"], success.graphPath);
    assert.equal(result["indexDirectory"], success.indexDirectory);
    assert.equal(result["parseSkipped"], false, "v1 always parses");
    assert.equal(result["nodeCount"], 29);
    assert.equal(result["edgeCount"], 40);
    assert.equal(result["regionCount"], 4);
    assert.equal(result["preserveCount"], 0);
    assert.equal(result["reconstructCount"], 4);
    assert.equal(result["hierarchyDepth"], 4);
    assert.equal(result["excludedDirectoryCount"], 3);
    assert.ok(!("crossScopeAmbiguities" in result), "omitted, not defaulted to zero");
    assert.deepEqual(result["durationMs"], { parse: 21, group: 9, total: 30 });
  } finally {
    project.cleanup();
  }
});

test("prose is a rendering of the same fields", async () => {
  const project = tempDirectory();
  try {
    const { io, out, errs } = captureIo();
    assert.equal(await main([project.dir], io, recordingRunner().run), 0);
    assert.equal(errs.length, 0);
    const text = out.join("\n");
    assert.ok(text.includes("29 nodes / 40 edges"), text);
    assert.ok(text.includes("4 (preserve 0 / reconstruct 4)"), text);
    assert.ok(text.includes(success.indexDirectory), text);
  } finally {
    project.cleanup();
  }
});

test("each engine failure stage keeps its own error shape and exits 1", async () => {
  const project = tempDirectory();
  const failures: readonly EngineResult[] = [
    { ok: false, stage: "engine", error: { code: "INVALID_OPTIONS", field: "concurrency", detail: "must be >= 1" } },
    {
      ok: false,
      stage: "parse",
      errors: [{ reason: "no-java-files", message: "no .java files were found" }],
    },
    {
      ok: false,
      stage: "group",
      error: { code: "EMPTY_GRAPH" },
      graphPath: "/project/.repohive/graph.json",
    },
  ];

  try {
    for (const failure of failures) {
      assert.ok(!failure.ok);
      const { io, out, errs } = captureIo();
      assert.equal(await main([project.dir, "--json"], io, recordingRunner(failure).run), 1);
      assert.equal(errs.length, 0);

      const document = soleJsonDocument(out);
      assert.equal(document["ok"], false);
      assert.equal(document["command"], "index");
      assert.equal(document["stage"], failure.stage);
      assert.equal(typeof document["message"], "string");

      if (failure.stage === "parse") {
        const errors = document["errors"] as Record<string, unknown>[];
        assert.equal(errors[0]?.["reason"], "no-java-files");
      } else if (failure.stage === "group") {
        assert.equal((document["error"] as Record<string, unknown>)["code"], "EMPTY_GRAPH");
        assert.equal(document["graphPath"], "/project/.repohive/graph.json");
      } else {
        assert.equal((document["error"] as Record<string, unknown>)["code"], "INVALID_OPTIONS");
      }

      // The same failure without --json is prose on stderr and nothing on stdout.
      const prose = captureIo();
      assert.equal(await main([project.dir], prose.io, recordingRunner(failure).run), 1);
      assert.equal(prose.out.length, 0);
      assert.ok(prose.errs.length > 0);
    }
  } finally {
    project.cleanup();
  }
});
