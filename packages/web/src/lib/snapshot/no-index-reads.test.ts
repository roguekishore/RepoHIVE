/**
 * The app reads snapshots, never an index. No
 * non-test source under `src/` may import `parseIndex`, read an `index/`
 * directory, or bring back the registry and loader that did.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && p !== __filename) out.push(p);
  }
  return out;
}

describe("the app does not read an index", () => {
  it("has no parseIndex, index loader, registry or index-directory reads", () => {
    const forbidden = /parseIndex|readGraphFile|loadIndex|repo-registry|index-loader|resolveIndexDir|(?<![A-Z_])REPOWISE_API_URL/;
    const offenders = walk(SRC)
      .filter((file) => forbidden.test(readFileSync(file, "utf8")))
      // The comment in the API client that records the removal names the variable.
      .filter((file) => !file.endsWith(join("lib", "api", "client.ts")));
    expect(offenders).toEqual([]);
  });
});
