/**
 * `repohive index` — the product interface: parse, then group, in one call.
 *
 * The two stages stay separately invokable as `parse` and `group` because
 * algorithm spec Req 4.4 requires boundary sweeps without code changes, and
 * because running `parse` alone is the natural move when a graph looks wrong.
 * Those are the research and debugging interface. This is the one a user runs.
 *
 * The orchestration itself is not here. It is `indexProject` in
 * `@repohive/engine`, which the MCP server and the hosted service call as
 * well; if it lived in this package they would import a package called "cli".
 * This command is an argument surface and a renderer over that one call, and
 * takes the call itself as a parameter so the surface is testable without a
 * Java project.
 *
 * v1 always parses. Skipping a parse when `graph.json` looks current is the
 * snapshot-id seam; the cheap substitute is an mtime comparison, and a wrong
 * skip silently serves a stale index, which is far worse than a redundant
 * parse. The engine reports `parseSkipped: false` accordingly, and this
 * command passes that through rather than hiding it.
 *
 * The parse-stage exclusion flags (`--include-generated`, `--exclude`) are
 * deliberately not on this command in v1: the decided surface is `--out`,
 * `--json` and the grouping tuning flags. A project needing exclusion control
 * runs `parse` then `group`. Adding the flags later is additive and safe;
 * removing them would not be.
 */

import { statSync } from "node:fs";
import {
  describeEngineFailure,
  indexProject,
  type EngineOptions,
  type EngineResult,
} from "@repohive/engine";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "./exit-codes.js";
import { GROUPING_FLAG_USAGE, parseGroupingArgv } from "./grouping-args.js";
import { consoleIo, type CliIo } from "./io.js";
import {
  emitJson,
  engineFailureDocument,
  successDocument,
  usageFailureDocument,
  type JsonDurations,
} from "./json.js";
import { resolveFromCwd } from "./paths.js";

export const INDEX_SUMMARY = "parse then group a Java project into .repohive/";

const USAGE = `RepoHIVE index — parse then group a Java project

usage: repohive index <dir> [options]

options:
  --out <dir>                     output root for both artifacts
                                  (default <dir>/.repohive)
${GROUPING_FLAG_USAGE}
  --json                          machine-readable output on stdout
  --help                          show this message

writes <out>/graph.json and <out>/index/, the five-file contract. <dir> is
required. the parse-stage exclusion flags live on \`repohive parse\`.`;

/** Everything a successful run reports. Mirrors the engine's success fields. */
export interface IndexResultJson {
  outputDirectory: string;
  graphPath: string;
  indexDirectory: string;
  /** Always false in v1: the engine always parses. */
  parseSkipped: boolean;
  nodeCount: number;
  edgeCount: number;
  regionCount: number;
  /** Raw decision counts; per-region detail lives in the index's metadata. */
  preserveCount: number;
  reconstructCount: number;
  hierarchyDepth: number;
  /** Omitted when the parse stage omits them, rather than defaulted to zero. */
  crossScopeAmbiguities?: number;
  excludedDirectoryCount?: number;
  durationMs: JsonDurations;
}

/** The orchestration call, injectable so tests never touch a Java project. */
export type IndexRunner = (options: EngineOptions) => Promise<EngineResult>;

/** Run the index CLI. Returns the process exit code. */
export async function main(
  argv: readonly string[],
  io: CliIo = consoleIo,
  run: IndexRunner = indexProject,
): Promise<number> {
  const parsed = parseGroupingArgv(argv, {
    maxPositionals: 1,
    missingInputMessage: "a project directory is required",
  });
  const json = parsed.ok && "value" in parsed ? parsed.value.json : argv.includes("--json");

  if (!parsed.ok) {
    if (json) {
      emitJson(io, usageFailureDocument("index", parsed.message));
      return EXIT_USAGE;
    }
    io.error(`index: ${parsed.message}`);
    io.error(USAGE);
    return EXIT_USAGE;
  }
  if ("help" in parsed) {
    io.log(USAGE);
    return EXIT_OK;
  }

  const projectDirectory = resolveFromCwd(parsed.value.input);
  try {
    statSync(projectDirectory);
  } catch {
    const message = `path not found: ${projectDirectory}`;
    if (json) {
      emitJson(io, usageFailureDocument("index", message));
      return EXIT_USAGE;
    }
    io.error(`index: ${message}`);
    return EXIT_USAGE;
  }

  const grouping = parsed.value.config;
  const result = await run({
    projectDirectory,
    ...(parsed.value.outDir !== undefined
      ? { outputDirectory: resolveFromCwd(parsed.value.outDir) }
      : {}),
    // Omitted rather than passed empty, so the core applies its own defaults
    // through exactly the path an untuned run takes.
    ...(Object.keys(grouping).length > 0 ? { grouping } : {}),
  });

  if (!result.ok) {
    if (json) {
      emitJson(io, engineFailureDocument("index", result));
      return EXIT_FAILURE;
    }
    io.error(`index: ${describeEngineFailure(result)}`);
    return EXIT_FAILURE;
  }

  const { value } = result;

  if (json) {
    const document: IndexResultJson = {
      outputDirectory: value.outputDirectory,
      graphPath: value.graphPath,
      indexDirectory: value.indexDirectory,
      parseSkipped: value.parseSkipped,
      nodeCount: value.nodeCount,
      edgeCount: value.edgeCount,
      regionCount: value.regionCount,
      preserveCount: value.preserveCount,
      reconstructCount: value.reconstructCount,
      hierarchyDepth: value.hierarchyDepth,
      ...(value.crossScopeAmbiguities !== undefined
        ? { crossScopeAmbiguities: value.crossScopeAmbiguities }
        : {}),
      ...(value.excludedDirectoryCount !== undefined
        ? { excludedDirectoryCount: value.excludedDirectoryCount }
        : {}),
      durationMs: {
        parse: value.durationMs.parse,
        group: value.durationMs.group,
        total: value.durationMs.total,
      },
    };
    emitJson(io, successDocument("index", document));
    return EXIT_OK;
  }

  const round = (ms: number): string => `${Math.round(ms)} ms`;
  io.log("RepoHIVE index — parse then group");
  io.log(`  project  : ${projectDirectory}`);
  io.log(`  graph    : ${value.nodeCount} nodes / ${value.edgeCount} edges`);
  io.log(
    `  regions  : ${value.regionCount} (preserve ${value.preserveCount} / reconstruct ${value.reconstructCount})`,
  );
  io.log(`  depth    : ${value.hierarchyDepth}`);
  io.log(`  output   : ${value.outputDirectory}`);
  io.log(`  index    : ${value.indexDirectory}`);
  io.log(
    `  timing   : parse ${round(value.durationMs.parse)} + group ${round(
      value.durationMs.group,
    )} = ${round(value.durationMs.total)}`,
  );
  io.log("  result   : OK");
  return EXIT_OK;
}
