/**
 * Grouping_System orchestrator: sequence ingest → weight → assess → construct
 * → assemble → metadata (→ optionally serialize) with a fail-fast atomic
 * error gate — any stage error is returned as a value and nothing is written.
 */

import { readFileSync } from "node:fs";
import type { RawDependencyGraph } from "@repohive/shared";
import { assess, DEFAULT_ASSESSMENT_CONFIG } from "./assessor.js";
import { construct } from "./constructor.js";
import { LouvainCommunityDetector, type CommunityDetector } from "./community.js";
import { err, ok, type Result } from "./errors.js";
import { buildHierarchy, DEFAULT_HIERARCHY_CONFIG } from "./hierarchy-builder.js";
import { buildMetadata } from "./metadata.js";
import { serializeIndex } from "./index-serializer.js";
import { ingest } from "./ingestor.js";
import { computeWeights, DEFAULT_WEIGHT_COEFFICIENTS, type WeightCoefficients } from "./weights.js";
import type {
  Action,
  AssessmentConfig,
  Hierarchy,
  HierarchyConfig,
  Metadata,
  RegionId,
} from "./types.js";

export interface GroupingConfig {
  /** The preserve/reconstruct decision boundary on the [0,1] score (4.4). */
  structuralQualityBoundary: number;
  /** Per-Region user overrides of the automatic decision (4.6). */
  overrides?: Map<RegionId, Action>;
  /** Seed for the injected CommunityDetector (4.7). */
  communityDetectionSeed: number;
  weightCoefficients: WeightCoefficients;
  assessment: AssessmentConfig;
  hierarchy: HierarchyConfig;
}

export const DEFAULT_GROUPING_CONFIG: GroupingConfig = {
  structuralQualityBoundary: 0.5,
  communityDetectionSeed: 42,
  weightCoefficients: DEFAULT_WEIGHT_COEFFICIENTS,
  assessment: DEFAULT_ASSESSMENT_CONFIG,
  hierarchy: DEFAULT_HIERARCHY_CONFIG,
};

export interface GroupingOutput {
  hierarchy: Hierarchy;
  metadata: Metadata;
}

/**
 * Drop entries whose value is `undefined` so a caller passing an explicitly
 * undefined option (a natural pattern when plumbing optional CLI flags) can
 * never clobber a default — a plain object spread would.
 */
function definedEntries<T extends object>(value: T | undefined): Partial<T> {
  if (value === undefined) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Deep-merge a partial config over the defaults (undefined never wins). */
export function resolveConfig(partial?: PartialGroupingConfig): GroupingConfig {
  return {
    structuralQualityBoundary: partial?.structuralQualityBoundary ?? DEFAULT_GROUPING_CONFIG.structuralQualityBoundary,
    ...(partial?.overrides !== undefined ? { overrides: partial.overrides } : {}),
    communityDetectionSeed: partial?.communityDetectionSeed ?? DEFAULT_GROUPING_CONFIG.communityDetectionSeed,
    weightCoefficients: { ...DEFAULT_WEIGHT_COEFFICIENTS, ...definedEntries(partial?.weightCoefficients) },
    assessment: {
      ...DEFAULT_ASSESSMENT_CONFIG,
      ...definedEntries(partial?.assessment),
      weights: { ...DEFAULT_ASSESSMENT_CONFIG.weights, ...definedEntries(partial?.assessment?.weights) },
    },
    hierarchy: { ...DEFAULT_HIERARCHY_CONFIG, ...definedEntries(partial?.hierarchy) },
  };
}

export interface PartialGroupingConfig {
  structuralQualityBoundary?: number;
  overrides?: Map<RegionId, Action>;
  communityDetectionSeed?: number;
  weightCoefficients?: Partial<WeightCoefficients>;
  assessment?: Partial<Omit<AssessmentConfig, "weights">> & { weights?: Partial<AssessmentConfig["weights"]> };
  hierarchy?: Partial<HierarchyConfig>;
}

/**
 * Convert an unexpected throw into a structured error.
 *
 * The engine promises errors-as-values, but a reachable path could still throw
 * — a `null` element in an untrusted `graph.json` raised a `TypeError` straight
 * out of `ingest` — and a thrown error crosses every boundary uncaught, taking
 * the whole run with it. One backstop per public entry point makes the promise
 * total: no future invariant violation can escape as a stack trace.
 */
function internalError(cause: unknown): Result<never> {
  return err({
    code: "INTERNAL_ERROR",
    detail: cause instanceof Error ? cause.message : String(cause),
  });
}

/** Run the full in-memory pipeline over a raw dependency graph. */
export function groupGraph(
  input: RawDependencyGraph | null | undefined,
  partialConfig?: PartialGroupingConfig,
  detector: CommunityDetector = new LouvainCommunityDetector()
): Result<GroupingOutput> {
  try {
    return groupGraphUnguarded(input, partialConfig, detector);
  } catch (cause) {
    return internalError(cause);
  }
}

function groupGraphUnguarded(
  input: RawDependencyGraph | null | undefined,
  partialConfig: PartialGroupingConfig | undefined,
  detector: CommunityDetector
): Result<GroupingOutput> {
  const config = resolveConfig(partialConfig);

  const ingested = ingest(input);
  if (!ingested.ok) {
    return ingested;
  }
  const weighted = computeWeights(ingested.value, config.weightCoefficients);
  const assessment = assess(weighted, config.assessment);
  const constructed = construct(
    weighted,
    assessment,
    {
      structuralQualityBoundary: config.structuralQualityBoundary,
      ...(config.overrides !== undefined ? { overrides: config.overrides } : {}),
      communityDetectionSeed: config.communityDetectionSeed,
    },
    detector
  );
  const hierarchy = buildHierarchy(constructed, weighted, config.hierarchy);
  if (!hierarchy.ok) {
    return hierarchy;
  }
  const metadata = buildMetadata(hierarchy.value, {
    structuralQualityBoundary: config.structuralQualityBoundary,
    metricWeights: assessment.metricWeights,
    cohesionSquashConstant: assessment.cohesionSquashConstant,
    regionDecisions: constructed.decisions,
  });

  return ok({ hierarchy: hierarchy.value, metadata });
}

/** Run the pipeline and write the Index_File_Set to `outDir`. */
export function groupGraphToIndex(
  input: RawDependencyGraph | null | undefined,
  outDir: string,
  partialConfig?: PartialGroupingConfig,
  detector?: CommunityDetector
): Result<GroupingOutput> {
  const output = groupGraph(input, partialConfig, detector);
  if (!output.ok) {
    return output;
  }
  try {
    const written = serializeIndex(output.value.hierarchy, output.value.metadata, outDir);
    if (!written.ok) {
      return written;
    }
  } catch (cause) {
    return internalError(cause);
  }
  return output;
}

/** Load a graph.json from disk (malformed input → MALFORMED_FILE). */
export function readGraphFile(path: string): Result<RawDependencyGraph> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return err({ code: "MALFORMED_FILE", file: path, detail: "file could not be read" });
  }
  try {
    const parsed = JSON.parse(text) as RawDependencyGraph;
    return ok(parsed);
  } catch (cause) {
    return err({ code: "MALFORMED_FILE", file: path, detail: `invalid JSON: ${String(cause)}` });
  }
  // Element shapes are not checked here: `ingest` is the gate that validates
  // them (R1.7), and it is the only consumer of this value.
}
