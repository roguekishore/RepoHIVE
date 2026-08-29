/**
 * Determinism demo aid (executable entry point).
 *
 * Runs the {@link verifyDeterminism} harness against a Java project and prints
 * the shared SHA-256 digest, demonstrating that the parser is deterministic:
 * identical input produces a byte-identical `graph.json` (R9.1).
 *
 * Wired to `npm run demo:determinism` in this package's `package.json`. With no
 * argument it targets the checked-in `fixtures/sample-java-project` (resolved
 * relative to this file, so it works from any working directory); an explicit
 * project directory may be passed as the first CLI argument, and an optional run
 * count as the second.
 *
 * Usage:
 *   npm run demo:determinism
 *   npm run demo:determinism -- <projectDirectory> [runs]
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { runDeterminismDemo } from "./verify-determinism.js";

/** Resolve the default fixture directory relative to this compiled module. */
function defaultFixtureDirectory(): string {
  // This file compiles to <repo>/packages/parser/dist/demo-determinism.js, so
  // the repository root is three levels up and the fixture lives beneath it.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "fixtures", "sample-java-project");
}

async function main(): Promise<void> {
  const [projectArg, runsArg] = process.argv.slice(2);
  // Resolved against INIT_CWD, matching parse-cli: under `npm run --workspace`
  // the process cwd is the *package* directory, so a relative path typed at the
  // repository root resolved to the wrong place.
  const projectDirectory =
    projectArg !== undefined && projectArg.trim().length > 0
      ? path.resolve(process.env["INIT_CWD"] ?? process.cwd(), projectArg)
      : defaultFixtureDirectory();

  // An out-of-range `runs` was silently replaced with 3, so `... 0` reported a
  // successful 3-run check the caller never asked for (Fix 18 — Gap 18). Two is
  // the minimum that can demonstrate anything: one run has nothing to compare
  // against.
  const runs = runsArg === undefined ? 3 : Number(runsArg);
  if (!Number.isInteger(runs) || runs < 2) {
    // eslint-disable-next-line no-console
    console.error(
      `demo: runs must be an integer >= 2 (one run cannot demonstrate determinism), got ${JSON.stringify(runsArg)}`,
    );
    // eslint-disable-next-line no-console
    console.error("usage: npm run demo:determinism -- <projectDirectory> [runs>=2]");
    process.exitCode = 2;
    return;
  }

  const exitCode = await runDeterminismDemo(projectDirectory, runs);
  process.exitCode = exitCode;
}

void main();
