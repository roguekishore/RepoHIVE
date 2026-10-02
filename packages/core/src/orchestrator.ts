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
import {
  buildHierarchy,
  DEFAULT_HIERARCHY_CONFIG,
  validateHierarchyConfig,
} from "./hierarchy-builder.js";
import { buildMetadata } from "./metadata.js";
import { serializeIndex, serializeIndexAsync } from "./index-serializer.js";
import { ingest } from "./ingestor.js";
import { computeWeights, DEFAULT_WEIGHT_COEFFICIENTS, type WeightCoefficients } from "./weights.js";
import { sortIds } from "./canonical.js";
import type {
  Action,
  AssessmentConfig,
  Hierarchy,
  HierarchyConfig,
  Metadata,
  RegionId,
  RunConfiguration,
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

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Validate the *resolved* configuration before any work happens (Gap 9).
 *
 * Nothing checked these values. A `NaN` boundary made every `score > boundary`
 * comparison false, so the run silently reconstructed every region — and then
 * wrote `NaN` into `metadata.json`, where `JSON.stringify` renders it as `null`,
 * which the engine's own `parseIndex` rejects. The same missing gate sat behind
 * negative coefficients (every strength clamps to 0, so everything preserves at
 * confidence 0), a non-positive squash constant, and a `degenerateScore` outside
 * `[0,1]`. One gate closes all of them.
 *
 * Running before ingest matters: a config error should surface before Louvain
 * has run, not halfway through the pipeline.
 *
 * The boundary is required to be **finite only**, not within `[0,1]`. `NaN` and
 * `±Infinity` are the values that actually break the comparison and the
 * metadata; `1.000001` is the sanctioned way `demo-baselines` expresses "always
 * reconstruct", and rejecting it would break a demo to fix nothing.
 */
export function validateConfig(config: GroupingConfig): Result<GroupingConfig> {
  const bad = (field: string, value: unknown, detail: string): Result<GroupingConfig> =>
    err({
      code: "INVALID_CONFIG",
      field,
      detail: `${field}: ${detail} (got ${JSON.stringify(value) ?? String(value)})`,
    });

  if (!Number.isFinite(config.structuralQualityBoundary)) {
    return bad("structuralQualityBoundary", config.structuralQualityBoundary, "must be a finite number");
  }
  if (!Number.isSafeInteger(config.communityDetectionSeed)) {
    return bad("communityDetectionSeed", config.communityDetectionSeed, "must be a safe integer");
  }

  for (const [key, value] of Object.entries(config.weightCoefficients)) {
    if (!isFiniteNonNegative(value)) {
      return bad(`weightCoefficients.${key}`, value, "must be finite and >= 0");
    }
  }

  const weights = config.assessment.weights;
  for (const [key, value] of Object.entries(weights)) {
    if (value !== undefined && !isFiniteNonNegative(value)) {
      return bad(`assessment.weights.${key}`, value, "must be finite and >= 0");
    }
  }
  // At least one *active* metric must carry weight, or every score collapses to
  // the same value and the preserve/reconstruct decision stops meaning anything.
  const activeSum =
    weights.cohesion +
    weights.coupling +
    (config.assessment.computeModularity ? (weights.modularity ?? 0) : 0);
  if (!(activeSum > 0)) {
    return bad("assessment.weights", weights, "at least one active metric weight must be > 0");
  }

  if (!isFinitePositive(config.assessment.cohesionSquashConstant)) {
    return bad(
      "assessment.cohesionSquashConstant",
      config.assessment.cohesionSquashConstant,
      "must be finite and > 0"
    );
  }
  if (
    !Number.isFinite(config.assessment.degenerateScore) ||
    config.assessment.degenerateScore < 0 ||
    config.assessment.degenerateScore > 1
  ) {
    return bad(
      "assessment.degenerateScore",
      config.assessment.degenerateScore,
      "must be finite and within [0, 1]"
    );
  }

  // The hierarchy bounds were validated inside buildHierarchy, i.e. after ingest,
  // weighting, assessment and community detection had already run. Moving the
  // check here makes every configuration failure fail at the same, earliest point.
  const hierarchy = validateHierarchyConfig(config.hierarchy);
  if (!hierarchy.ok) {
    return err(hierarchy.error);
  }
  return ok(config);
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

/**
 * Project the resolved config onto its serializable audit record (Gap 22).
 *
 * The override Map becomes a plain object with canonically-sorted keys so the
 * record serializes deterministically — `stableStringify` sorts object keys, but
 * a Map would stringify to `{}`.
 */
function runConfigurationOf(config: GroupingConfig): RunConfiguration {
  const overrides: Record<string, Action> = {};
  for (const regionId of sortIds([...(config.overrides?.keys() ?? [])])) {
    overrides[regionId] = config.overrides!.get(regionId)!;
  }
  return {
    structuralQualityBoundary: config.structuralQualityBoundary,
    communityDetectionSeed: config.communityDetectionSeed,
    weightCoefficients: { ...config.weightCoefficients },
    assessment: {
      weights: { ...config.assessment.weights },
      computeModularity: config.assessment.computeModularity,
      cohesionSquashConstant: config.assessment.cohesionSquashConstant,
      degenerateScore: config.assessment.degenerateScore,
    },
    hierarchy: { ...config.hierarchy },
    overrides,
  };
}

/**
 * The grouping sub-stages, in the order they run. {@link groupGraphToIndexAsync}
 * reports each one as it begins; `"write"` exists only on the path that writes
 * the index.
 */
export type GroupingSubstage = "ingest" | "weight" | "assess" | "construct" | "hierarchy" | "metadata" | "write";

/** A progress event from the grouping pipeline: a sub-stage is about to run. */
export interface GroupingProgressEvent {
  substage: GroupingSubstage;
}

/** Options for {@link groupGraphToIndexAsync}. */
export interface GroupingRunOptions {
  /** Community detector. Defaults to the Louvain detector. */
  detector?: CommunityDetector;
  /**
   * Called as each sub-stage begins. Not awaited. The pipeline then yields to
   * the event loop before running the sub-stage, so work the callback schedules
   * can run first. A throw is reported as `INTERNAL_ERROR`. Cannot change any
   * output byte.
   */
  onProgress?: (event: GroupingProgressEvent) => void;
}

/**
 * The pipeline as a generator: it yields the name of each sub-stage just before
 * running it and returns the result. One body serves the synchronous entry
 * points (which just run it through) and the asynchronous one (which lets the
 * event loop breathe between sub-stages), so the two can never drift apart.
 */
function* groupPipeline(
  input: RawDependencyGraph | null | undefined,
  partialConfig: PartialGroupingConfig | undefined,
  detector: CommunityDetector
): Generator<GroupingSubstage, Result<GroupingOutput>, undefined> {
  const config = resolveConfig(partialConfig);

  // The configuration gate runs first, before any work: an invalid parameter
  // should cost an error message, not a completed pipeline with wrong numbers.
  const validated = validateConfig(config);
  if (!validated.ok) {
    return err(validated.error);
  }

  yield "ingest";
  const ingested = ingest(input);
  if (!ingested.ok) {
    return ingested;
  }
  yield "weight";
  const weighted = computeWeights(ingested.value, config.weightCoefficients);
  yield "assess";
  const assessment = assess(weighted, config.assessment);
  yield "construct";
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
  yield "hierarchy";
  const hierarchy = buildHierarchy(constructed, weighted, config.hierarchy);
  if (!hierarchy.ok) {
    return hierarchy;
  }
  // Join the audit record to the tree (Gap 12): each decision names the group
  // nodes it produced, so a consumer can go from "this region was reconstructed
  // with score 0.31" to the boxes on screen.
  yield "metadata";
  const groupIdsOfRegion = hierarchy.value.groupIdsOfRegion;
  const decisions = constructed.decisions.map((decision) => {
    const groupIds = groupIdsOfRegion?.get(decision.regionId);
    return groupIds === undefined ? decision : { ...decision, groupIds: sortIds(groupIds) };
  });

  const metadata = buildMetadata(hierarchy.value, {
    structuralQualityBoundary: config.structuralQualityBoundary,
    metricWeights: assessment.metricWeights,
    cohesionSquashConstant: assessment.cohesionSquashConstant,
    regionDecisions: decisions,
    configuration: runConfigurationOf(config),
  });

  return ok({ hierarchy: hierarchy.value, metadata });
}

/** Run a pipeline generator to completion without yielding to anything. */
function runToCompletion<T>(pipeline: Generator<GroupingSubstage, T, undefined>): T {
  for (;;) {
    const step = pipeline.next();
    if (step.done === true) {
      return step.value;
    }
  }
}

/** Let the event loop run one turn, so work scheduled by a callback can start. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Run the full in-memory pipeline over a raw dependency graph. */
export function groupGraph(
  input: RawDependencyGraph | null | undefined,
  partialConfig?: PartialGroupingConfig,
  detector: CommunityDetector = new LouvainCommunityDetector()
): Result<GroupingOutput> {
  try {
    return runToCompletion(groupPipeline(input, partialConfig, detector));
  } catch (cause) {
    return internalError(cause);
  }
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

/**
 * {@link groupGraphToIndex} for a caller that wants to watch it and keep its
 * event loop alive: it reports each sub-stage as it begins, yields to the event
 * loop before running it, and writes the five index files concurrently.
 * Results and bytes are identical to the synchronous entry point.
 */
export async function groupGraphToIndexAsync(
  input: RawDependencyGraph | null | undefined,
  outDir: string,
  partialConfig?: PartialGroupingConfig,
  options: GroupingRunOptions = {}
): Promise<Result<GroupingOutput>> {
  try {
    const pipeline = groupPipeline(input, partialConfig, options.detector ?? new LouvainCommunityDetector());
    let output: Result<GroupingOutput>;
    for (;;) {
      const step = pipeline.next();
      if (step.done === true) {
        output = step.value;
        break;
      }
      options.onProgress?.({ substage: step.value });
      await yieldToEventLoop();
    }
    if (!output.ok) {
      return output;
    }
    options.onProgress?.({ substage: "write" });
    await yieldToEventLoop();
    const written = await serializeIndexAsync(output.value.hierarchy, output.value.metadata, outDir);
    if (!written.ok) {
      return written;
    }
    return output;
  } catch (cause) {
    return internalError(cause);
  }
}

/** Load a graph.json from disk (malformed input → MALFORMED_FILE). */
export function readGraphFile(path: string): Result<RawDependencyGraph> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // Distinct from MALFORMED_FILE: a missing graph.json is neither an *index*
    // file nor *malformed*, and reporting it as one sent readers looking for a
    // content problem that did not exist (Gap 20).
    return err({ code: "FILE_NOT_FOUND", file: path });
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
