/**
 * `repohive parse` — stage 1 alone: Java sources to `.repohive/graph.json`.
 *
 * Moved here from `packages/parser/src/parse-cli.ts` and hardened to the same
 * standard as the group command, because what was moved was materially weaker:
 * an ad-hoc `args.indexOf("--exclude")`, a positional filter that dropped any
 * argument beginning with `--` without ever rejecting one, no unknown-flag
 * rejection, and a default target of `fixtures/sample-java-project` resolved
 * relative to `dist/`. That default is demo behaviour and must not ship: a
 * packaged binary run with no argument that silently indexes a fixture inside
 * its own installation is indistinguishable from a broken install. A missing
 * directory is now a usage error.
 *
 * What else changed with the move:
 *
 * - relative paths resolve against `process.cwd()`, never `INIT_CWD`;
 * - the output lands under the decided layout, `<dir>/.repohive/graph.json`,
 *   rather than the parser default of `<dir>/graph.json`;
 * - a second positional is rejected rather than read as an output path, so
 *   `--out` is the one way to redirect output, as it is for every command;
 * - `--json` prints the result as a document instead of prose;
 * - `main(argv, io, run)` takes the parse function, so the argument surface is
 *   testable without touching a Java project.
 */

import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_EXCLUDED_SEGMENTS,
  parseProject,
  type ParseError,
  type ParseOptions,
  type ParseSuccess,
  type Result,
} from "@repohive/parser";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "./exit-codes.js";
import { consoleIo, type CliIo } from "./io.js";
import {
  emitJson,
  parseFailureDocument,
  successDocument,
  usageFailureDocument,
  type JsonDurations,
} from "./json.js";
import { resolveFromCwd } from "./paths.js";

export const PARSE_SUMMARY = "stage 1 alone: Java sources to .repohive/graph.json";

/** The output root's name under the project directory, per the decided layout. */
const OUTPUT_ROOT_NAME = ".repohive";

const GRAPH_FILE_NAME = "graph.json";

const USAGE = `RepoHIVE parse — Java sources to a dependency graph

usage: repohive parse <dir> [options]

options:
  --out <dir>                     directory to write graph.json into
                                  (default <dir>/.repohive)
  --include-generated             turn the default exclusions off and collect
                                  every .java file found
  --exclude a,b,c                 extra directory-name segments to exclude,
                                  added to the default list
  --json                          machine-readable output on stdout
  --help                          show this message

<dir> is required. there is no default project directory.`;

export interface ParsedArgs {
  projectDirectory: string;
  outDir?: string;
  includeGenerated: boolean;
  extraExcludes: readonly string[];
  json: boolean;
}

export type ArgsResult =
  | { ok: true; value: ParsedArgs }
  | { ok: true; help: true }
  | { ok: false; message: string };

/** What a successful parse reports. Mirrors the parser's own success fields. */
export interface ParseResultJson {
  outputDirectory: string;
  graphPath: string;
  nodeCount: number;
  edgeCount: number;
  /** Omitted when the parser omits it, rather than defaulted to zero. */
  crossScopeAmbiguities?: number;
  excludedDirectoryCount?: number;
  durationMs: JsonDurations;
}

/** The parse function, injectable so tests never touch a Java project. */
export type ParseRunner = (
  options: ParseOptions,
) => Promise<Result<ParseSuccess, ParseError>>;

/**
 * Parse the CLI arguments.
 *
 * Unknown flags and extra positionals are errors, for the reason the group
 * command already records: silently ignoring them turns a typo into a run at
 * defaults that looks successful.
 */
export function parseParseArgs(argv: readonly string[]): ArgsResult {
  const positionals: string[] = [];
  const extraExcludes: string[] = [];
  let includeGenerated = false;
  let json = false;
  let outFlag: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (token === "--help" || token === "-h") {
      return { ok: true, help: true };
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--include-generated") {
      includeGenerated = true;
      continue;
    }

    if (token === "--out" || token === "--exclude") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, message: `${token} requires a value` };
      }
      if (token === "--out") {
        outFlag = value;
        continue;
      }
      const segments = value
        .split(",")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
      if (segments.length === 0) {
        return { ok: false, message: "--exclude requires at least one directory name" };
      }
      extraExcludes.push(...segments);
      continue;
    }

    if (token.startsWith("-")) {
      return { ok: false, message: `unknown option: ${token}` };
    }

    positionals.push(token);
  }

  if (positionals.length === 0) {
    return { ok: false, message: "a project directory is required" };
  }
  if (positionals.length > 1) {
    return { ok: false, message: `unexpected extra argument: ${positionals[1]}` };
  }
  if (includeGenerated && extraExcludes.length > 0) {
    return {
      ok: false,
      message: "--include-generated turns exclusions off, so --exclude cannot be combined with it",
    };
  }

  return {
    ok: true,
    value: {
      projectDirectory: positionals[0]!,
      ...(outFlag !== undefined ? { outDir: outFlag } : {}),
      includeGenerated,
      extraExcludes,
      json,
    },
  };
}

/**
 * Resolve the exclusion set.
 *
 * `undefined` means the collector's default list; an empty set means include
 * everything. The two are different instructions, not two spellings of one.
 */
function resolveExcludedSegments(args: ParsedArgs): ReadonlySet<string> | undefined {
  if (args.includeGenerated) {
    return new Set();
  }
  if (args.extraExcludes.length > 0) {
    return new Set([...DEFAULT_EXCLUDED_SEGMENTS, ...args.extraExcludes]);
  }
  return undefined;
}

function reportFailure(io: CliIo, json: boolean, errors: readonly ParseError[]): number {
  const message = errors
    .map((error) => `${error.reason}: ${error.message}${error.path ? ` (${error.path})` : ""}`)
    .join("; ");
  if (json) {
    emitJson(io, parseFailureDocument("parse", message, errors));
    return EXIT_FAILURE;
  }
  io.error("RepoHIVE parse — FAILED");
  for (const error of errors) {
    io.error(`    - ${error.reason}: ${error.message}${error.path ? ` (${error.path})` : ""}`);
  }
  return EXIT_FAILURE;
}

/** Run the parse CLI. Returns the process exit code. */
export async function main(
  argv: readonly string[],
  io: CliIo = consoleIo,
  run: ParseRunner = parseProject,
): Promise<number> {
  const startedAt = performance.now();
  const parsed = parseParseArgs(argv);
  const json = parsed.ok && "value" in parsed ? parsed.value.json : argv.includes("--json");

  if (!parsed.ok) {
    if (json) {
      emitJson(io, usageFailureDocument("parse", parsed.message));
      return EXIT_USAGE;
    }
    io.error(`parse: ${parsed.message}`);
    io.error(USAGE);
    return EXIT_USAGE;
  }
  if ("help" in parsed) {
    io.log(USAGE);
    return EXIT_OK;
  }

  const projectDirectory = resolveFromCwd(parsed.value.projectDirectory);
  try {
    statSync(projectDirectory);
  } catch {
    const message = `path not found: ${projectDirectory}`;
    if (json) {
      emitJson(io, usageFailureDocument("parse", message));
      return EXIT_USAGE;
    }
    io.error(`parse: ${message}`);
    return EXIT_USAGE;
  }

  const outputDirectory =
    parsed.value.outDir !== undefined
      ? resolveFromCwd(parsed.value.outDir)
      : join(projectDirectory, OUTPUT_ROOT_NAME);
  const graphPath = join(outputDirectory, GRAPH_FILE_NAME);

  // The parser writes graph.json but does not create the directory holding it,
  // and the output root only exists once something has written there. Created
  // after the input check, so a bad input path cannot fabricate directories.
  try {
    mkdirSync(outputDirectory, { recursive: true });
  } catch (cause: unknown) {
    return reportFailure(io, json, [
      {
        reason: "output-unwritable",
        message: cause instanceof Error ? cause.message : String(cause),
        path: outputDirectory,
      },
    ]);
  }

  const excludedSegments = resolveExcludedSegments(parsed.value);
  const result = await run({
    projectDirectory,
    outputPath: graphPath,
    ...(excludedSegments !== undefined ? { excludedSegments } : {}),
  });

  if (!result.ok) {
    return reportFailure(io, json, result.errors);
  }

  const finishedAt = performance.now();
  const { value } = result;

  if (json) {
    const document: ParseResultJson = {
      outputDirectory,
      graphPath: value.outputPath,
      nodeCount: value.nodeCount,
      edgeCount: value.edgeCount,
      ...(value.crossScopeAmbiguities !== undefined
        ? { crossScopeAmbiguities: value.crossScopeAmbiguities }
        : {}),
      ...(value.excludedDirectoryCount !== undefined
        ? { excludedDirectoryCount: value.excludedDirectoryCount }
        : {}),
      durationMs: { parse: finishedAt - startedAt, total: finishedAt - startedAt },
    };
    emitJson(io, successDocument("parse", document));
    return EXIT_OK;
  }

  io.log("RepoHIVE parse — Java sources to a dependency graph");
  io.log(`  project : ${projectDirectory}`);
  io.log(`  nodes   : ${value.nodeCount}`);
  io.log(`  edges   : ${value.edgeCount}`);
  if (value.crossScopeAmbiguities) {
    io.log(
      `  x-scope : ${value.crossScopeAmbiguities} cross-root ambiguit${
        value.crossScopeAmbiguities === 1 ? "y" : "ies"
      } (byte-first pick, recorded)`,
    );
  }
  io.log(
    parsed.value.includeGenerated
      ? "  exclude : off (--include-generated)"
      : `  exclude : ${value.excludedDirectoryCount ?? 0} dir(s) skipped (build/VCS/generated)`,
  );
  io.log(`  output  : ${value.outputPath}`);
  io.log("  result  : OK");
  return EXIT_OK;
}
