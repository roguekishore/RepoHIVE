/**
 * `repohive group` — stage 2 alone: a `graph.json` to the five-file `index/`.
 *
 * Moved here from `packages/core/src/group-cli.ts`, where it was a temporary
 * demo wrapper on the wrong side of the engine/ecosystem boundary. The flag
 * surface, the routing of every value through the core's `validateConfig`, the
 * rejection of unknown flags and extra positionals, and the testable
 * `main(argv, io) -> exit code` are carried over unchanged; what changed is
 * only what had to:
 *
 * - relative paths resolve against `process.cwd()`, never `INIT_CWD`;
 * - the `process.argv[1].endsWith("group-cli.js")` self-execution guard is
 *   gone, because `cli.ts` invokes dispatch unconditionally under the shim;
 * - `--json` prints the result as a document instead of prose;
 * - the tuning flags themselves moved to `grouping-args.ts`, shared verbatim
 *   with `repohive index`.
 *
 * It keeps its full flag surface because algorithm spec Req 4.4 requires the
 * structural-quality boundary to be varied across runs *without code changes*
 * so a sensitivity analysis can be run. Every parsed value still goes through
 * `validateConfig` inside the core, so the CLI cannot become a second injection
 * route for the values that gate rejects.
 *
 * `--out` names the directory that receives the five index files, which is the
 * same rule every command follows: `--out` is the directory this command
 * writes into. Its default is a sibling `index/` of the graph file, so
 * grouping `.repohive/graph.json` writes `.repohive/index/` without being told
 * to, and a sweep can put each run somewhere of its own.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describeError, groupGraphToIndex, readGraphFile } from "@repohive/core";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "./exit-codes.js";
import {
  GROUPING_FLAG_USAGE,
  parseGroupingArgv,
  type GroupingArgsResult,
  type ParsedGroupingArgs,
} from "./grouping-args.js";
import { consoleIo, type CliIo } from "./io.js";
import {
  emitJson,
  groupFailureDocument,
  successDocument,
  usageFailureDocument,
  type JsonDurations,
} from "./json.js";
import { resolveFromCwd } from "./paths.js";

export const GROUP_SUMMARY = "stage 2 alone: a graph.json to the five-file index/";

export type ParsedArgs = ParsedGroupingArgs;
export type ArgsResult = GroupingArgsResult;

const USAGE = `RepoHIVE group — adaptive hierarchical grouping

usage: repohive group <graph.json | dir> [outDir] [options]

options:
  --out <dir>                     directory to write the five index files into
${GROUPING_FLAG_USAGE}
  --json                          machine-readable output on stdout
  --help                          show this message

a directory argument resolves to <dir>/.repohive/graph.json when that exists,
otherwise to <dir>/graph.json. the default output directory is a sibling
index/ of the graph file, so grouping .repohive/graph.json writes
.repohive/index/.`;

/** The five index files and the grouping counts a successful run reports. */
export interface GroupResultJson {
  graphPath: string;
  indexDirectory: string;
  regionCount: number;
  preserveCount: number;
  reconstructCount: number;
  structuralQualityBoundary: number;
  /** Nodes in the built hierarchy, not nodes in the input graph. */
  hierarchyNodeCount: number;
  hierarchyDepth: number;
  leafEdgeCount: number;
  crossGroupEdgeCount: number;
  durationMs: JsonDurations;
}

/** Parse the group command's arguments. Two positionals: input and outDir. */
export function parseGroupArgs(argv: readonly string[]): ArgsResult {
  return parseGroupingArgv(argv, {
    maxPositionals: 2,
    missingInputMessage: "an input path is required",
  });
}

/**
 * Locate the graph file a directory argument means.
 *
 * `.repohive/graph.json` first, because that is where `repohive index` and
 * `repohive parse` write it, then `<dir>/graph.json`, which is where the
 * pre-`.repohive` layout put it and what the demo scripts still produce. A
 * directory holding neither falls through to the second path so the failure
 * reported is "graph.json not found", not "you gave me a directory".
 */
function graphFileWithin(directory: string): string {
  const underOutputRoot = join(directory, ".repohive", "graph.json");
  return existsSync(underOutputRoot) ? underOutputRoot : join(directory, "graph.json");
}

/** Run the grouping CLI. Returns the process exit code. */
export function main(argv: readonly string[], io: CliIo = consoleIo): number {
  const startedAt = performance.now();
  const parsed = parseGroupArgs(argv);
  const json = parsed.ok && "value" in parsed ? parsed.value.json : argv.includes("--json");

  if (!parsed.ok) {
    if (json) {
      emitJson(io, usageFailureDocument("group", parsed.message));
      return EXIT_USAGE;
    }
    io.error(`group: ${parsed.message}`);
    io.error(USAGE);
    return EXIT_USAGE;
  }
  if ("help" in parsed) {
    io.log(USAGE);
    return EXIT_OK;
  }

  let graphPath = resolveFromCwd(parsed.value.input);
  try {
    if (statSync(graphPath).isDirectory()) {
      graphPath = graphFileWithin(graphPath);
    }
  } catch {
    // The named path does not exist at all, so the command line never became a
    // runnable request: a usage error, not a run that failed.
    const message = `path not found: ${graphPath}`;
    if (json) {
      emitJson(io, usageFailureDocument("group", message));
      return EXIT_USAGE;
    }
    io.error(`group: ${message}`);
    return EXIT_USAGE;
  }

  // Derived from the graph file's *directory*, so an input whose name does not
  // end in `.json` still produces a sibling `index/` rather than a path under
  // the file itself.
  const outDir =
    parsed.value.outDir !== undefined
      ? resolveFromCwd(parsed.value.outDir)
      : join(dirname(graphPath), "index");

  const groupStartedAt = performance.now();
  const graph = readGraphFile(graphPath);
  if (!graph.ok) {
    const message = describeError(graph.error);
    if (json) {
      emitJson(io, groupFailureDocument("group", message, graph.error, graphPath));
      return EXIT_FAILURE;
    }
    io.error(`group: ${message}`);
    return EXIT_FAILURE;
  }

  const result = groupGraphToIndex(graph.value, outDir, parsed.value.config);
  if (!result.ok) {
    const message = describeError(result.error);
    if (json) {
      emitJson(io, groupFailureDocument("group", message, result.error, graphPath));
      return EXIT_FAILURE;
    }
    io.error(`group: ${message}`);
    return EXIT_FAILURE;
  }

  const { hierarchy, metadata } = result.value;
  const preserved = metadata.regionDecisions.filter((d) => d.action === "preserve").length;
  const reconstructed = metadata.regionDecisions.length - preserved;
  const finishedAt = performance.now();

  if (json) {
    const value: GroupResultJson = {
      graphPath,
      indexDirectory: outDir,
      regionCount: metadata.regionDecisions.length,
      preserveCount: preserved,
      reconstructCount: reconstructed,
      structuralQualityBoundary: metadata.structuralQualityBoundary,
      hierarchyNodeCount: metadata.nodeCount,
      hierarchyDepth: hierarchy.depth,
      leafEdgeCount: hierarchy.leafEdges.length,
      crossGroupEdgeCount: hierarchy.crossGroupEdges.length,
      durationMs: {
        group: finishedAt - groupStartedAt,
        total: finishedAt - startedAt,
      },
    };
    emitJson(io, successDocument("group", value));
    return EXIT_OK;
  }

  io.log("RepoHIVE group — adaptive hierarchical grouping");
  io.log(`  input    : ${graphPath}`);
  io.log(
    `  regions  : ${metadata.regionDecisions.length} (preserve ${preserved} / reconstruct ${reconstructed})`
  );
  io.log(`  boundary : ${metadata.structuralQualityBoundary}`);
  io.log(`  nodes    : ${metadata.nodeCount} hierarchy nodes (depth ${hierarchy.depth})`);
  io.log(`  edges    : ${hierarchy.leafEdges.length} leaf + ${hierarchy.crossGroupEdges.length} cross-group`);
  io.log(`  output   : ${outDir}`);
  io.log("  result   : OK");
  return EXIT_OK;
}
