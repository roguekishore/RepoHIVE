/**
 * The snapshot-id inputs: `engineVersion` moves with
 * the build, `configDigest` moves with the options that shape output and with
 * nothing else.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULT_EXCLUDED_SEGMENTS } from "@repohive/parser";
import { INDEX_FORMAT_VERSION as coreFormatVersion } from "@repohive/core";

import { INDEX_FORMAT_VERSION, configDigest, engineVersion } from "./index.js";
import { engineVersionOf, type EngineVersionInputs } from "./snapshot-inputs.js";

// --- engineVersion -------------------------------------------------------------

test("engineVersion is 16 hex characters, and the format version is core's", () => {
  assert.match(engineVersion, /^[0-9a-f]{16}$/);
  assert.equal(INDEX_FORMAT_VERSION, coreFormatVersion);
});

/** A scratch "build" of two packages, and the inputs that hash it. */
function withBuild(run: (root: string, inputs: () => EngineVersionInputs) => void): void {
  const root = mkdtempSync(join(tmpdir(), "repohive-engine-version-"));
  try {
    for (const name of ["a", "b"]) {
      mkdirSync(join(root, name, "sub"), { recursive: true });
      writeFileSync(join(root, name, "index.js"), `export const ${name} = 1;\n`, "utf8");
      writeFileSync(join(root, name, "sub", "inner.js"), "export {};\n", "utf8");
    }
    run(root, () => ({
      indexFormatVersion: 1,
      packageDists: [
        ["pkg-a", join(root, "a")],
        ["pkg-b", join(root, "b")],
      ],
      grammarVersions: [
        ["tree-sitter-java", "0.23.5"],
        ["web-tree-sitter", "0.26.10"],
      ],
    }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("engineVersion changes with engine code, a grammar version, or the index format", () => {
  withBuild((root, inputs) => {
    const base = engineVersionOf(inputs());
    assert.equal(engineVersionOf(inputs()), base, "same build, same value");

    writeFileSync(join(root, "a", "sub", "inner.js"), "export const changed = true;\n", "utf8");
    assert.notEqual(engineVersionOf(inputs()), base, "a code change moves it");
    writeFileSync(join(root, "a", "sub", "inner.js"), "export {};\n", "utf8");
    assert.equal(engineVersionOf(inputs()), base, "restoring the code restores it");

    assert.notEqual(
      engineVersionOf({ ...inputs(), grammarVersions: [["tree-sitter-java", "0.23.6"], ["web-tree-sitter", "0.26.10"]] }),
      base,
      "tree-sitter-java moves it",
    );
    assert.notEqual(
      engineVersionOf({ ...inputs(), grammarVersions: [["tree-sitter-java", "0.23.5"], ["web-tree-sitter", "0.27.0"]] }),
      base,
      "web-tree-sitter moves it",
    );
    assert.notEqual(engineVersionOf({ ...inputs(), indexFormatVersion: 2 }), base, "the index format moves it");
  });
});

test("engineVersion ignores test files, source maps, declarations and line endings", () => {
  withBuild((root, inputs) => {
    const base = engineVersionOf(inputs());
    writeFileSync(join(root, "a", "thing.test.js"), "throw new Error('tests are not the engine');\n", "utf8");
    writeFileSync(join(root, "a", "index.js.map"), "{}", "utf8");
    writeFileSync(join(root, "a", "index.d.ts"), "export declare const a = 1;\n", "utf8");
    assert.equal(engineVersionOf(inputs()), base);

    writeFileSync(join(root, "a", "index.js"), "export const a = 1;\r\n", "utf8");
    assert.equal(engineVersionOf(inputs()), base, "CRLF and LF builds agree");
  });
});

// --- configDigest --------------------------------------------------------------

test("configDigest is a SHA-256 hex digest, repeatable in one process", () => {
  assert.match(configDigest({}), /^[0-9a-f]{64}$/);
  assert.equal(configDigest({}), configDigest({}));
});

test("an omitted default and the same value given explicitly give the same digest", () => {
  const base = configDigest({});
  assert.equal(configDigest({ grouping: {} }), base);
  assert.equal(configDigest({ grouping: { communityDetectionSeed: 42, structuralQualityBoundary: 0.5 } }), base);
  assert.equal(configDigest({ grouping: { communityDetectionSeed: undefined } }), base);
  assert.equal(configDigest({ grouping: { hierarchy: {}, assessment: { weights: {} } } }), base);
  assert.equal(configDigest({ excludedSegments: new Set(DEFAULT_EXCLUDED_SEGMENTS) }), base);
});

test("options that cannot change output do not change the digest", () => {
  const base = configDigest({ projectDirectory: "/a" });
  assert.equal(configDigest({ projectDirectory: "/somewhere/else" }), base);
  assert.equal(configDigest({ source: [] }), base, "directory or memory source");
  assert.equal(
    configDigest({
      projectDirectory: "/a",
      workers: 7,
      concurrency: 3,
      onProgress: () => undefined,
      outputDirectory: "/out",
      writeGraph: false,
    }),
    base,
  );
});

test("every option that shapes output changes the digest", () => {
  const base = configDigest({});
  const variants = {
    seed: configDigest({ grouping: { communityDetectionSeed: 43 } }),
    boundary: configDigest({ grouping: { structuralQualityBoundary: 0.6 } }),
    coefficient: configDigest({ grouping: { weightCoefficients: { importCoefficient: 9 } } }),
    assessment: configDigest({ grouping: { assessment: { cohesionSquashConstant: 3 } } }),
    hierarchy: configDigest({ grouping: { hierarchy: { maxGroupSize: 7 } } }),
    override: configDigest({ grouping: { overrides: new Map([["region:a", "preserve" as const]]) } }),
    excluded: configDigest({ excludedSegments: new Set(["target"]) }),
    noExclusions: configDigest({ excludedSegments: new Set() }),
  };
  const all = [base, ...Object.values(variants)];
  assert.equal(new Set(all).size, all.length, `all digests differ: ${JSON.stringify(variants)}`);
});

test("the order options are given in does not matter", () => {
  assert.equal(
    configDigest({ excludedSegments: new Set(["build", "target", "out"]) }),
    configDigest({ excludedSegments: new Set(["out", "build", "target"]) }),
  );
  assert.equal(
    configDigest({ grouping: { overrides: new Map([["region:a", "preserve" as const], ["region:b", "reconstruct" as const]]) } }),
    configDigest({ grouping: { overrides: new Map([["region:b", "reconstruct" as const], ["region:a", "preserve" as const]]) } }),
  );
});

test("a nonsense value still has a digest rather than throwing", () => {
  assert.doesNotThrow(() => configDigest({ grouping: { structuralQualityBoundary: Number.NaN } }));
  assert.notEqual(configDigest({ grouping: { structuralQualityBoundary: Number.NaN } }), configDigest({}));
  assert.notEqual(
    configDigest({ grouping: { structuralQualityBoundary: Number.NaN } }),
    configDigest({ grouping: { structuralQualityBoundary: Number.POSITIVE_INFINITY } }),
  );
});

test("engineVersion and configDigest are the same in another process", () => {
  const entry = new URL("./index.js", import.meta.url).href;
  const script = `import(${JSON.stringify(entry)}).then((e) => console.log(JSON.stringify([e.engineVersion, e.configDigest({ grouping: { communityDetectionSeed: 7 } })])))`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), [engineVersion, configDigest({ grouping: { communityDetectionSeed: 7 } })]);
});
