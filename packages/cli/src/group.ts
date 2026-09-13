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
 * - `--json` prints the result as a document instead of prose.
 *
 * It keeps its full flag surface because algorithm spec Req 4.4 requires the
 * structural-quality boundary to be varied across runs *without code changes*
 * so a sensitivity analysis can be run. Every parsed value still goes through
 * `validateConfig` inside the core, so the CLI cannot become a second injection
 * route for the values that gate rejects.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  describeError,
  groupGraphToIndex,
  readGraphFile,
  type Action,
  type PartialGroupingConfig,
  type RegionId,
} from "@repohive/core";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "./exit-codes.js";
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

const USAGE = `RepoHIVE group — adaptive hierarchical grouping

usage: repohive group <graph.json | dir> [outDir] [options]

options:
  --out <dir>                     directory to write the five index files into
  --boundary <n>                  structural-quality decision boundary
  --seed <int>                    community-detection seed
  --max-group-size <int>          maximum children per group node
  --min-partition-threshold <int> minimum partition slice size
  --weight-cohesion <n>           metric weight: cohesion
  --weight-coupling <n>           metric weight: coupling
  --weight-modularity <n>         metric weight: modularity
  --squash-k <n>                  cohesion squash constant (> 0)
  --degenerate-score <n>          score for degenerate regions, within [0,1]
  --compute-modularity            compute Newman Q as a secondary signal
  --preserve <regionId>           force preserve for a region (repeatable)
  --reconstruct <regionId>        force reconstruct for a region (repeatable)
  --json                          machine-readable output on stdout
  --help                          show this message

a directory argument resolves to <dir>/.repohive/graph.json when that exists,
otherwise to <dir>/graph.json. the default output directory is a sibling
index/ of the graph file, so grouping .repohive/graph.json writes
.repohive/index/.`;

/** Flags taking a numeric value, mapped onto their config location. */
const NUMERIC_FLAGS = {
  "--boundary": "structuralQualityBoundary",
  "--seed": "communityDetectionSeed",
  "--max-group-size": "maxGroupSize",
  "--min-partition-threshold": "minPartitionThreshold",
  "--weight-cohesion": "cohesion",
  "--weight-coupling": "coupling",
  "--weight-modularity": "modularity",
  "--squash-k": "cohesionSquashConstant",
  "--degenerate-score": "degenerateScore",
} as const;

type NumericFlag = keyof typeof NUMERIC_FLAGS;

export interface ParsedArgs {
  input: string;
  outDir?: string;
  json: boolean;
  config: PartialGroupingConfig;
}

export type ArgsResult =
  | { ok: true; value: ParsedArgs }
  | { ok: true; help: true }
  | { ok: false; message: string };

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

function isNumericFlag(token: string): token is NumericFlag {
  return Object.prototype.hasOwnProperty.call(NUMERIC_FLAGS, token);
}

/**
 * Parse the CLI arguments into a partial config.
 *
 * Unknown flags and extra positionals are errors: silently ignoring them (the
 * behaviour before this argument surface existed) turns a typo in a sweep into
 * a run at default parameters that *looks* successful, which is the worst
 * possible outcome for an experiment whose whole point is varying one
 * parameter.
 */
export function parseGroupArgs(argv: readonly string[]): ArgsResult {
  const positionals: string[] = [];
  const numbers = new Map<NumericFlag, number>();
  const overrides = new Map<RegionId, Action>();
  let computeModularity = false;
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

    if (token === "--compute-modularity") {
      computeModularity = true;
      continue;
    }

    if (token === "--out" || token === "--preserve" || token === "--reconstruct") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, message: `${token} requires a value` };
      }
      if (token === "--out") {
        outFlag = value;
        continue;
      }
      const action: Action = token === "--preserve" ? "preserve" : "reconstruct";
      const existing = overrides.get(value);
      if (existing !== undefined && existing !== action) {
        return {
          ok: false,
          message: `region ${value} is given conflicting overrides (preserve and reconstruct)`,
        };
      }
      overrides.set(value, action);
      continue;
    }

    if (isNumericFlag(token)) {
      const raw = argv[++i];
      if (raw === undefined || raw.startsWith("--")) {
        return { ok: false, message: `${token} requires a numeric value` };
      }
      const value = Number(raw);
      // Checked here as well as in validateConfig so a typo yields a usage
      // error naming the flag, rather than a NaN travelling into the config.
      if (!Number.isFinite(value)) {
        return { ok: false, message: `${token} requires a finite number, got ${JSON.stringify(raw)}` };
      }
      numbers.set(token, value);
      continue;
    }

    if (token.startsWith("-")) {
      return { ok: false, message: `unknown option: ${token}` };
    }

    positionals.push(token);
  }

  if (positionals.length === 0) {
    return { ok: false, message: "an input path is required" };
  }
  if (positionals.length > 2) {
    return { ok: false, message: `unexpected extra argument: ${positionals[2]}` };
  }

  const config: PartialGroupingConfig = {};
  const set = <T>(flag: NumericFlag, apply: (value: number) => T): void => {
    const value = numbers.get(flag);
    if (value !== undefined) {
      apply(value);
    }
  };

  set("--boundary", (v) => (config.structuralQualityBoundary = v));
  set("--seed", (v) => (config.communityDetectionSeed = v));

  const hierarchy: NonNullable<PartialGroupingConfig["hierarchy"]> = {};
  set("--max-group-size", (v) => (hierarchy.maxGroupSize = v));
  set("--min-partition-threshold", (v) => (hierarchy.minPartitionThreshold = v));
  if (Object.keys(hierarchy).length > 0) {
    config.hierarchy = hierarchy;
  }

  const weights: NonNullable<NonNullable<PartialGroupingConfig["assessment"]>["weights"]> = {};
  set("--weight-cohesion", (v) => (weights.cohesion = v));
  set("--weight-coupling", (v) => (weights.coupling = v));
  set("--weight-modularity", (v) => (weights.modularity = v));

  const assessment: NonNullable<PartialGroupingConfig["assessment"]> = {};
  if (Object.keys(weights).length > 0) {
    assessment.weights = weights;
  }
  set("--squash-k", (v) => (assessment.cohesionSquashConstant = v));
  set("--degenerate-score", (v) => (assessment.degenerateScore = v));
  if (computeModularity) {
    assessment.computeModularity = true;
  }
  if (Object.keys(assessment).length > 0) {
    config.assessment = assessment;
  }

  if (overrides.size > 0) {
    config.overrides = overrides;
  }

  const outDir = outFlag ?? positionals[1];
  return {
    ok: true,
    value: {
      input: positionals[0]!,
      ...(outDir !== undefined ? { outDir } : {}),
      json,
      config,
    },
  };
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
