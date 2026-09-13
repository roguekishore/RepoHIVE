/**
 * Engine test launcher. Enumerates compiled test files explicitly and runs
 * them with `node --test <files...>`, so the run depends on neither shell
 * glob expansion nor the Node version's `--test` path semantics.
 *
 * Why this exists: the previous script, `node --test dist/*.test.js`, had no
 * correct form across Node versions. The glob needed the shell to expand it
 * (POSIX shells do, cmd.exe does not; native glob support landed in Node 21),
 * and the alternative `node --test dist/` silently resolves to `dist/index.js`
 * alone on Node 21+, reporting one passing test while running none of the
 * suite. Explicit enumeration closes both holes, and the zero-file guard
 * below makes a vacuous green run impossible.
 *
 * Usage, from a package directory (npm sets cwd there for workspace scripts):
 *   node ../../scripts/run-node-tests.mjs [testDir]
 *
 * The first argument that does not start with "-" is the directory to scan
 * (default "dist", non-recursive, files ending in ".test.js"). Arguments
 * starting with "-" are forwarded to `node --test`; use the "--flag=value"
 * form, for example:
 *   npm test -- --test-name-pattern=determinism
 *
 * Dependency-free by design: node: builtins only.
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const passThroughFlags = args.filter((arg) => arg.startsWith("-"));
const positionals = args.filter((arg) => !arg.startsWith("-"));

if (positionals.length > 1) {
  console.error(`run-node-tests: expected at most one directory argument, got: ${positionals.join(" ")}`);
  process.exit(1);
}

const testDir = resolve(process.cwd(), positionals[0] ?? "dist");

let entries;
try {
  entries = readdirSync(testDir, { withFileTypes: true });
} catch (error) {
  console.error(`run-node-tests: cannot read test directory ${testDir} (${error.code ?? error.message})`);
  console.error('run-node-tests: build first ("npm run build" from the repo root) so compiled tests exist.');
  process.exit(1);
}

const testFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
  .map((entry) => join(testDir, entry.name))
  .sort();

if (testFiles.length === 0) {
  console.error(`run-node-tests: no *.test.js files in ${testDir}`);
  console.error("run-node-tests: refusing to report a pass on zero test files; a green run must mean the suite ran.");
  console.error('run-node-tests: build first ("npm run build" from the repo root), then retry.');
  process.exit(1);
}

console.error(`run-node-tests: running ${testFiles.length} test file(s) from ${testDir}`);

const result = spawnSync(process.execPath, ["--test", ...passThroughFlags, ...testFiles], {
  stdio: "inherit",
});

if (result.error) {
  console.error(`run-node-tests: failed to launch node --test (${result.error.message})`);
  process.exit(1);
}
if (result.signal !== null) {
  console.error(`run-node-tests: node --test was terminated by signal ${result.signal}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
