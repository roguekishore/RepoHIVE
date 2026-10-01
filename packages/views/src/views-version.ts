/**
 * The views version (hosting-2 Glossary): a build-time hash of this package's
 * compiled code and dependency versions, written to `dist/views-version.json`
 * by `scripts/write-views-version.mjs` after `tsc -b`. Read at run time so
 * compilation never depends on the generated file.
 */
import { readFileSync } from "node:fs";

let cached: string | undefined;

function readViewsVersion(): string {
  const file = new URL("./views-version.json", import.meta.url);
  let parsed: { viewsVersion?: unknown };
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as { viewsVersion?: unknown };
  } catch {
    throw new Error("views version: dist/views-version.json is missing; run the root build (it writes it after tsc -b)");
  }
  if (typeof parsed.viewsVersion !== "string" || !/^[0-9a-f]{16}$/.test(parsed.viewsVersion)) {
    throw new Error("views version: dist/views-version.json is malformed");
  }
  return parsed.viewsVersion;
}

/**
 * The views version. Read on first call, not at import: a bundler (the viewer's
 * Next.js build) evaluates every import, and the viewer has no use for the
 * version nor the generated file next to its bundled chunk.
 */
export function getViewsVersion(): string {
  cached ??= readViewsVersion();
  return cached;
}
