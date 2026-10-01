/**
 * The two engine-side inputs a hosted snapshot id is built from: which engine
 * produced an index ({@link engineVersion}) and which options shaped it
 * ({@link configDigest}). A snapshot id that mixes these with the source's
 * identity changes exactly when the output could change, and not otherwise.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_EXCLUDED_SEGMENTS } from "@repohive/parser";
import {
  INDEX_FORMAT_VERSION,
  compareIds,
  resolveConfig,
  runConfigurationOf,
  stableStringify,
} from "@repohive/core";

import type { EngineOptions } from "./orchestrator.js";

/** The packages whose compiled code decides what the engine writes. */
const ENGINE_PACKAGE_SPECIFIERS = ["@repohive/shared", "@repohive/parser", "@repohive/core"] as const;

/** Third-party packages that decide how Java is read; their versions are part of the engine's identity. */
const GRAMMAR_PACKAGES = ["tree-sitter-java", "web-tree-sitter"] as const;

/** Every `.js` file under `dir` other than tests, as sorted `/`-separated relative paths. */
function compiledFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(current, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.isFile() && entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) {
        found.push(`${prefix}${entry.name}`);
      }
    }
  };
  walk(dir, "");
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The version of an installed package, found the way Node resolution would, by walking up from `fromDir`. */
function installedVersion(name: string, fromDir: string): string {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const manifest = join(dir, "node_modules", name, "package.json");
    if (existsSync(manifest)) {
      return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
    }
    if (dirname(dir) === dir) {
      throw new Error(`engineVersion: cannot find the installed package ${name}`);
    }
  }
}

/** What {@link engineVersionOf} hashes. */
export interface EngineVersionInputs {
  /** The index format version. */
  indexFormatVersion: number;
  /** Each engine package's compiled directory, by package name. */
  packageDists: ReadonlyArray<readonly [name: string, dist: string]>;
  /** The installed grammar package versions, by package name. */
  grammarVersions: ReadonlyArray<readonly [name: string, version: string]>;
}

/** The hash behind {@link engineVersion}, over explicit inputs so a test can vary each one. */
export function engineVersionOf(inputs: EngineVersionInputs): string {
  const hash = createHash("sha256");
  hash.update(`index-format:${inputs.indexFormatVersion}\0`);
  for (const [name, dist] of inputs.packageDists) {
    for (const file of compiledFiles(dist)) {
      hash.update(`${name}/${file}\0`);
      // Line endings are whatever the compiler that built it wrote; the code is the same.
      hash.update(readFileSync(join(dist, file), "utf8").replace(/\r\n/g, "\n"));
      hash.update("\0");
    }
  }
  for (const [name, version] of inputs.grammarVersions) {
    hash.update(`${name}@${version}\0`);
  }
  return hash.digest("hex").slice(0, 16);
}

function computeEngineVersion(): string {
  const parserDist = dirname(fileURLToPath(import.meta.resolve("@repohive/parser")));
  return engineVersionOf({
    indexFormatVersion: INDEX_FORMAT_VERSION,
    packageDists: [
      ["@repohive/engine", dirname(fileURLToPath(import.meta.url))],
      ...ENGINE_PACKAGE_SPECIFIERS.map(
        (specifier) => [specifier, dirname(fileURLToPath(import.meta.resolve(specifier)))] as const,
      ),
    ],
    grammarVersions: GRAMMAR_PACKAGES.map((name) => [name, installedVersion(name, parserDist)] as const),
  });
}

/**
 * Identifies the engine build, for snapshot ids. A string of 16 hex characters.
 *
 * It is derived from the compiled code of `shared`, `parser`, `core` and this
 * package, the installed `tree-sitter-java` and `web-tree-sitter` versions, and
 * `INDEX_FORMAT_VERSION`, so it is fixed for a given build and changes whenever
 * any of them changes. Test files do not count, and neither do line endings.
 * It is computed once, when this module loads, and the same build gives the same
 * value on every platform.
 */
export const engineVersion: string = computeEngineVersion();

/**
 * Replace the numbers JSON cannot carry, so the digest of a nonsense option is
 * still defined (the run itself rejects it) rather than a throw.
 */
function digestable(value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return `non-finite:${String(value)}`;
  }
  if (Array.isArray(value)) {
    return value.map(digestable);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, digestable(member)]));
  }
  return value;
}

/**
 * SHA-256 (hex) over the canonical form of everything in `options` that can
 * change an output byte: the resolved grouping configuration (defaults filled
 * in, region overrides in sorted order) and the resolved source selection (the
 * excluded directory names, deduplicated and sorted).
 *
 * Options that resolve to the same configuration give the same digest, so an
 * omitted default and the same value given explicitly agree. Options that cannot
 * change output (`workers`, `concurrency`, `onProgress`, `outputDirectory`,
 * `writeGraph`, and whether the source is a directory or `source`) are not read.
 * The digest does not depend on the process, the platform or the run.
 */
export function configDigest(options: EngineOptions): string {
  const excluded = [...new Set(options.excludedSegments ?? DEFAULT_EXCLUDED_SEGMENTS)].sort(compareIds);
  const canonical = {
    grouping: runConfigurationOf(resolveConfig(options.grouping)),
    selection: { excludedSegments: excluded },
  };
  return createHash("sha256").update(stableStringify(digestable(canonical)), "utf8").digest("hex");
}
