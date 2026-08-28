/**
 * TEMPORARY demo wrapper — `npm run group -- <graph.json | dir> [outDir]`.
 *
 * Same status as the parser's parse-cli: a temporary demo convenience,
 * replaced by the packaged CLI later (architecture
 * engine-vs-ecosystem line). Relative paths resolve against INIT_CWD so the
 * root `npm run group` script behaves like a plain command.
 *
 * It nonetheless carries flag parsing, because Req 4.4 requires the
 * Structural_Quality_Boundary to be varied across runs *without code changes*
 * so a sensitivity analysis can be run — and that requirement sits in the
 * algorithm spec, so it is Phase-1 scope regardless of which wrapper exposes it
 * (Gap 20). Every parsed value goes through `validateConfig`, so the CLI cannot
 * become a second injection route for the values Gap 9 rejects.
 *
 * `main` takes its argv as a parameter and returns an exit code so the whole
 * surface is testable without spawning a process.
 */

import { statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { describeError } from "./errors.js";
import { groupGraphToIndex, readGraphFile, type PartialGroupingConfig } from "./orchestrator.js";
import type { Action, RegionId } from "./types.js";

const USAGE = `RepoHIVE group — adaptive hierarchical grouping

usage: npm run group -- <graph.json | project-dir> [outDir] [options]

options:
  --out <dir>                     output directory (same as the positional)
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
  --help                          show this message`;

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
  config: PartialGroupingConfig;
}

export type ArgsResult =
  | { ok: true; value: ParsedArgs }
  | { ok: true; help: true }
  | { ok: false; message: string };

function isNumericFlag(token: string): token is NumericFlag {
  return Object.prototype.hasOwnProperty.call(NUMERIC_FLAGS, token);
}

/**
 * Parse the CLI arguments into a partial config.
 *
 * Unknown flags and extra positionals are errors: silently ignoring them (the
 * previous behaviour) turns a typo in a sweep into a run at default parameters
 * that *looks* successful, which is the worst possible outcome for an
 * experiment whose whole point is varying one parameter.
 */
export function parseGroupArgs(argv: readonly string[]): ArgsResult {
  const positionals: string[] = [];
  const numbers = new Map<NumericFlag, number>();
  const overrides = new Map<RegionId, Action>();
  let computeModularity = false;
  let outFlag: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (token === "--help" || token === "-h") {
      return { ok: true, help: true };
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
      config,
    },
  };
}

function resolveAgainstInvocationDir(path: string): string {
  if (isAbsolute(path)) {
    return path;
  }
  const base = process.env["INIT_CWD"] ?? process.cwd();
  return resolve(base, path);
}

export interface CliIo {
  log(message: string): void;
  error(message: string): void;
}

const consoleIo: CliIo = {
  // eslint-disable-next-line no-console
  log: (message) => console.log(message),
  // eslint-disable-next-line no-console
  error: (message) => console.error(message),
};

/** Run the grouping CLI. Returns the process exit code. */
export function main(argv: readonly string[], io: CliIo = consoleIo): number {
  const parsed = parseGroupArgs(argv);
  if (!parsed.ok) {
    io.error(`group: ${parsed.message}`);
    io.error(USAGE);
    return 2;
  }
  if ("help" in parsed) {
    io.log(USAGE);
    return 0;
  }

  let graphPath = resolveAgainstInvocationDir(parsed.value.input);
  try {
    if (statSync(graphPath).isDirectory()) {
      graphPath = join(graphPath, "graph.json");
    }
  } catch {
    io.error(`group: path not found: ${graphPath}`);
    return 2;
  }

  // Derived from the graph file's *directory*, so an input whose name does not
  // end in `.json` still produces a sibling `index/` rather than a path under
  // the file itself (Gap 20).
  const outDir =
    parsed.value.outDir !== undefined
      ? resolveAgainstInvocationDir(parsed.value.outDir)
      : join(dirname(graphPath), "index");

  const graph = readGraphFile(graphPath);
  if (!graph.ok) {
    io.error(`group: ${describeError(graph.error)}`);
    return 1;
  }

  const result = groupGraphToIndex(graph.value, outDir, parsed.value.config);
  if (!result.ok) {
    io.error(`group: ${describeError(result.error)}`);
    return 1;
  }

  const { hierarchy, metadata } = result.value;
  const preserved = metadata.regionDecisions.filter((d) => d.action === "preserve").length;
  const reconstructed = metadata.regionDecisions.length - preserved;
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
  return 0;
}

// Executed only when run as a script, not when imported by a test.
if (process.argv[1]?.endsWith("group-cli.js")) {
  process.exitCode = main(process.argv.slice(2));
}
