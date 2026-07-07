/**
 * Review 1 demo aid (executable entry point).
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
  const projectDirectory =
    projectArg !== undefined && projectArg.trim().length > 0
      ? path.resolve(projectArg)
      : defaultFixtureDirectory();

  const runs = runsArg !== undefined ? Number.parseInt(runsArg, 10) : 3;
  const effectiveRuns = Number.isFinite(runs) && runs >= 2 ? runs : 3;

  const exitCode = await runDeterminismDemo(projectDirectory, effectiveRuns);
  process.exitCode = exitCode;
}

void main();
