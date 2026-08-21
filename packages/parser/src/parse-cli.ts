/**
 * `parse` demo entry point.
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
import { DEFAULT_EXCLUDED_SEGMENTS } from "./source-collector.js";

/** Resolve the default fixture directory relative to this compiled module. */
function defaultFixtureDirectory(): string {
  // Compiles to <repo>/packages/parser/dist/parse-cli.js, so the repository
  // root is three levels up and the fixture lives beneath it.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "fixtures", "sample-java-project");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Exclusion flags (Fix 16 — Gap 19):
  //   --include-generated   include everything (turn the default exclusions off)
  //   --exclude a,b,c        add segments to the default exclusion list
  const includeGenerated = args.includes("--include-generated");
  const excludeIdx = args.indexOf("--exclude");
  const extraExcludes =
    excludeIdx >= 0 && args[excludeIdx + 1] !== undefined
      ? args[excludeIdx + 1]!
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];

  // Positional args are everything that is neither a flag nor a flag's value.
  const flagValueIndices = new Set<number>();
  if (excludeIdx >= 0) flagValueIndices.add(excludeIdx + 1);
  const [projectArg, outputArg] = args.filter(
    (a, i) => !a.startsWith("--") && !flagValueIndices.has(i),
  );

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

  // undefined -> collector default list; empty set -> include everything.
  let excludedSegments: ReadonlySet<string> | undefined;
  if (includeGenerated) {
    excludedSegments = new Set();
  } else if (extraExcludes.length > 0) {
    excludedSegments = new Set([...DEFAULT_EXCLUDED_SEGMENTS, ...extraExcludes]);
  }

  const result = await parseProject({ projectDirectory, outputPath, excludedSegments });

  if (result.ok) {
    // eslint-disable-next-line no-console
    console.log(
      [
        `RepoHIVE parser — parse`,
        `  project : ${projectDirectory}`,
        `  nodes   : ${result.value.nodeCount}`,
        `  edges   : ${result.value.edgeCount}`,
        ...(result.value.crossScopeAmbiguities
          ? [
              `  x-scope : ${result.value.crossScopeAmbiguities} cross-root ambiguit${
                result.value.crossScopeAmbiguities === 1 ? "y" : "ies"
              } (byte-first pick, recorded)`,
            ]
          : []),
        includeGenerated
          ? `  exclude : off (--include-generated)`
          : `  exclude : ${result.value.excludedDirectoryCount ?? 0} dir(s) skipped (build/VCS/generated)`,
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
