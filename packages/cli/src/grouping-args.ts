/**
 * The grouping tuning flags, shared by `repohive group` and `repohive index`.
 *
 * Both commands accept the same tuning surface, so the flag table, the value
 * checking and the config assembly live here once. Two copies of a ten-flag
 * table drift the first time a flag is added to one of them, and a flag that
 * silently does nothing on `index` is the same failure the unknown-flag
 * rejection exists to prevent.
 *
 * The commands differ only in how many positionals they take and in what to
 * say when none is given, so those are parameters. Every message is worded
 * exactly as the group command worded it before the move.
 */

import type { Action, PartialGroupingConfig, RegionId } from "@repohive/core";

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

/** The tuning-flag block, rendered into both commands' usage text. */
export const GROUPING_FLAG_USAGE = `  --boundary <n>                  structural-quality decision boundary
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
  --reconstruct <regionId>        force reconstruct for a region (repeatable)`;

export interface ParsedGroupingArgs {
  input: string;
  outDir?: string;
  json: boolean;
  config: PartialGroupingConfig;
}

export type GroupingArgsResult =
  | { ok: true; value: ParsedGroupingArgs }
  | { ok: true; help: true }
  | { ok: false; message: string };

export interface GroupingArgvOptions {
  /** 1 for `index`, 2 for `group`, which still accepts `[outDir]`. */
  maxPositionals: 1 | 2;
  /** What to say when no positional was given. */
  missingInputMessage: string;
}

function isNumericFlag(token: string): token is NumericFlag {
  return Object.prototype.hasOwnProperty.call(NUMERIC_FLAGS, token);
}

/**
 * Parse an argv that mixes the tuning flags with a command's own positionals.
 *
 * Unknown flags and extra positionals are errors: silently ignoring them turns
 * a typo in a sweep into a run at default parameters that *looks* successful,
 * which is the worst possible outcome for an experiment whose whole point is
 * varying one parameter. Every value still passes through the core's
 * `validateConfig` afterwards, so this is a first gate, not the only one.
 */
export function parseGroupingArgv(
  argv: readonly string[],
  options: GroupingArgvOptions,
): GroupingArgsResult {
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
    return { ok: false, message: options.missingInputMessage };
  }
  if (positionals.length > options.maxPositionals) {
    return {
      ok: false,
      message: `unexpected extra argument: ${positionals[options.maxPositionals]}`,
    };
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
