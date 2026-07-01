/**
 * `parse` demo entry point (Review 1).
 *
 * A thin wrapper over {@link parseProject} so the parser can be run against any
 * Java project with a single command:
 *
 *   npm run parse -- <projectDirectory> [outputPath]
 *
 * It parses the given directory, writes `graph.json`, and prints a short
 * summary (node/edge counts + the output path). With no argument it targets the
 * checked-in `fixtures/sample-java-project`, so `npm run parse` alone produces a
 * demo graph.
 *
 * This is a demo-convenience script, not the packaged `parse` CLI (that
 * shrink-wrap is deferred to 8th-sem distribution). The command name `parse` is
 * a placeholder.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { parseProject } from "./orchestrator.js";

/** Resolve the default fixture directory relative to this compiled module. */
function defaultFixtureDirectory(): string {
  // Compiles to <repo>/packages/parser/dist/parse-cli.js, so the repository
  // root is three levels up and the fixture lives beneath it.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "fixtures", "sample-java-project");
}

async function main(): Promise<void> {
  const [projectArg, outputArg] = process.argv.slice(2);
  // Resolve relative paths against the directory the user invoked npm from
  // (INIT_CWD), not this module's cwd — npm's `--workspace` indirection changes
  // the process cwd to the package directory, which would break a relative arg.
  const invocationCwd = process.env.INIT_CWD ?? process.cwd();
  const projectDirectory =
    projectArg !== undefined && projectArg.trim().length > 0
      ? path.resolve(invocationCwd, projectArg)
      : defaultFixtureDirectory();

  const outputPath =
    outputArg !== undefined && outputArg.trim().length > 0
      ? path.resolve(invocationCwd, outputArg)
      : undefined;

  const result = await parseProject({ projectDirectory, outputPath });

  if (result.ok) {
    // eslint-disable-next-line no-console
    console.log(
      [
        `RepoHIVE parser — parse`,
        `  project : ${projectDirectory}`,
        `  nodes   : ${result.value.nodeCount}`,
        `  edges   : ${result.value.edgeCount}`,
        `  output  : ${result.value.outputPath}`,
        `  result  : OK`,
      ].join("\n"),
    );
    process.exitCode = 0;
    return;
  }

  // eslint-disable-next-line no-console
  console.error(
    [
      `RepoHIVE parser — parse FAILED`,
      `  project : ${projectDirectory}`,
      `  errors  :`,
      ...result.errors.map(
        (e) => `    - ${e.reason}: ${e.message}${e.path ? ` (${e.path})` : ""}`,
      ),
    ].join("\n"),
  );
  process.exitCode = 1;
}

void main();
