/**
 * The engine boundary: the engine packages import
 * nothing from the ecosystem side and carry no AWS, network or compression code,
 * and the write side builds no whole-artifact string.
 *
 * A source scan, not a behaviour test: it reads the packages' non-test `.ts`
 * files from the repository checkout, so it skips (and says so) when they are
 * not there.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const PACKAGES_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ENGINE_PACKAGES = ["shared", "parser", "core", "engine"] as const;

/** Every non-test `.ts` source file of an engine package, as `package/relative/path`. */
function sourceFiles(pkg: string): Array<{ name: string; text: string }> {
  const root = join(PACKAGES_ROOT, pkg, "src");
  if (!existsSync(root)) {
    return [];
  }
  const found: Array<{ name: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        found.push({ name: `${pkg}/${relative(root, full).split("\\").join("/")}`, text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(root);
  return found;
}

const allSources = ENGINE_PACKAGES.flatMap(sourceFiles);
const SKIP_REASON = "the engine packages' sources are not in this checkout";

/** The module specifiers a file imports or re-exports from, or dynamically imports. */
function specifiersOf(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) {
    found.push(match[1] as string);
  }
  return found;
}

test("engine packages import nothing from the ecosystem side", (t) => {
  if (allSources.length === 0) {
    t.skip(SKIP_REASON);
    return;
  }
  const forbidden = /^@repohive\/(cli|web|ui|api-client|types|mcp)(\/|$)/;
  const offenders = allSources.flatMap(({ name, text }) =>
    specifiersOf(text)
      .filter((specifier) => forbidden.test(specifier))
      .map((specifier) => `${name} imports ${specifier}`),
  );
  assert.deepEqual(offenders, []);
});

test("engine packages import no network, compression or AWS code", (t) => {
  if (allSources.length === 0) {
    t.skip(SKIP_REASON);
    return;
  }
  const forbidden = /^(?:node:)?(?:http|https|http2|net|tls|dgram|dns|zlib)$|^@aws-sdk\/|^aws-sdk$|^(?:undici|node-fetch|axios|got|brotli|pako|fflate)$/;
  const offenders = allSources.flatMap(({ name, text }) =>
    specifiersOf(text)
      .filter((specifier) => forbidden.test(specifier))
      .map((specifier) => `${name} imports ${specifier}`),
  );
  assert.deepEqual(offenders, []);

  const calls = allSources
    .filter(({ text }) => /\bfetch\s*\(/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")))
    .map(({ name }) => `${name} calls fetch()`);
  assert.deepEqual(calls, []);
});

test("every import an engine package makes of another is a package the engine side owns", (t) => {
  if (allSources.length === 0) {
    t.skip(SKIP_REASON);
    return;
  }
  const allowed = new Set(["@repohive/shared", "@repohive/parser", "@repohive/core", "@repohive/engine"]);
  const offenders = allSources.flatMap(({ name, text }) =>
    specifiersOf(text)
      .filter((specifier) => specifier.startsWith("@repohive/") && !allowed.has(specifier))
      .map((specifier) => `${name} imports ${specifier}`),
  );
  assert.deepEqual(offenders, []);
});

test("the index serializer renders chunks, never the one-string form of an artifact", (t) => {
  const serializer = allSources.find(({ name }) => name === "core/index-serializer.ts");
  if (serializer === undefined) {
    t.skip(SKIP_REASON);
    return;
  }
  const code = serializer.text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.ok(!/\bstableStringify\s*\(/.test(code), "the pretty one-string renderer is not used to write the index");
  assert.ok(!/\bcompactStringify\s*\(/.test(code), "the compact one-string renderer is not used to write the index");
  assert.ok(/compactStringifyPieces/.test(code), "the index is rendered as pieces");
});
