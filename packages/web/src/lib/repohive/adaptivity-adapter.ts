/**
 * Adaptivity adapter — the cross-repository comparison.
 *
 * The claim this surface exists to support: the engine *decides* per region
 * rather than applying one policy everywhere. The evidence is that the same
 * algorithm, the same weights, the same boundary and the same seed produce
 * materially different preserve rates on different repositories.
 *
 * The statistic is computed over **assessed regions only**. Regions that hit
 * the engine's degenerate rule were never measured — including them would drag
 * every repository toward "always reconstructs" and would be comparing repo
 * size rather than repo structure. The unassessed count is carried alongside so
 * the surface can state it rather than hide it.
 *
 * Pure apart from the `loadIndex` calls the route hands in: no clock, no RNG,
 * canonical ordering with an id tie-break.
 */

import type { Metadata, RegionDecision } from "@repohive/core";

/** Whether a decision was assigned by rule rather than measured. */
export function isDegenerateDecision(decision: RegionDecision): boolean {
  return decision.score === 0 && decision.cohesion === 0;
}

export interface AdaptivityRepo {
  id: string;
  name: string;
  /** Scale, so a reader can see the comparison is not between toy inputs. */
  files: number;
  nodes: number;
  edges: number;
  depth: number;
  regions: number;
  /** Regions the engine actually measured. */
  assessed: number;
  /** Of the assessed regions, how many kept their authored boundary. */
  preserved: number;
  /** Of the assessed regions, how many were rebuilt. */
  reconstructed: number;
  /** Regions scored by rule and never assessed. */
  degenerate: number;
  /** preserved / assessed, or null when nothing was assessed. */
  preserveShare: number | null;
  /** The recorded configuration this run used — the "same settings" claim. */
  config: {
    boundary: number;
    weights: { cohesion: number; coupling: number; modularity?: number };
    squashK: number;
    seed: number | null;
    maxGroupSize: number | null;
    minPartitionThreshold: number | null;
  };
  /** Score distribution of assessed regions, for the comparison strip. */
  assessedScores: number[];
}

export interface AdaptivityComparison {
  repos: AdaptivityRepo[];
  /**
   * True when every repo above ran with an identical configuration — which is
   * what licenses the "same algorithm, different answers" reading. When false
   * the surface must say so instead of implying a controlled comparison.
   */
  sameConfiguration: boolean;
  /** Human summary of what differs, when it does. */
  configurationNote: string | null;
}

export interface AdaptivityInput {
  id: string;
  name: string;
  metadata: Metadata;
  /** File-leaf count, taken from the parsed hierarchy by the caller. */
  files: number;
}

function configOf(metadata: Metadata): AdaptivityRepo["config"] {
  return {
    boundary: metadata.structuralQualityBoundary,
    weights: metadata.metricWeights,
    squashK: metadata.cohesionSquashConstant,
    seed: metadata.configuration?.communityDetectionSeed ?? null,
    maxGroupSize: metadata.configuration?.hierarchy?.maxGroupSize ?? null,
    minPartitionThreshold: metadata.configuration?.hierarchy?.minPartitionThreshold ?? null,
  };
}

/** A stable string for comparing two runs' configurations. */
function configKey(config: AdaptivityRepo["config"]): string {
  return JSON.stringify([
    config.boundary,
    config.weights.cohesion,
    config.weights.coupling,
    config.weights.modularity ?? null,
    config.squashK,
    config.seed,
    config.maxGroupSize,
    config.minPartitionThreshold,
  ]);
}

export function adaptAdaptivity(inputs: readonly AdaptivityInput[]): AdaptivityComparison {
  const repos: AdaptivityRepo[] = inputs
    .map(({ id, name, metadata, files }) => {
      const decisions = metadata.regionDecisions;
      const degenerate = decisions.filter(isDegenerateDecision);
      const assessed = decisions.filter((d) => !isDegenerateDecision(d));
      const preserved = assessed.filter((d) => d.action === "preserve");
      return {
        id,
        name,
        files,
        nodes: metadata.nodeCount,
        edges: metadata.edgeCount,
        depth: metadata.hierarchyDepth,
        regions: decisions.length,
        assessed: assessed.length,
        preserved: preserved.length,
        reconstructed: assessed.length - preserved.length,
        degenerate: degenerate.length,
        preserveShare: assessed.length === 0 ? null : preserved.length / assessed.length,
        config: configOf(metadata),
        // Ascending, so the comparison strip renders deterministically.
        assessedScores: assessed.map((d) => d.score).sort((a, b) => a - b),
      };
    })
    // Largest repository first: scale is part of the argument.
    .sort((a, b) => b.files - a.files || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const keys = new Set(repos.map((r) => configKey(r.config)));
  const sameConfiguration = repos.length > 0 && keys.size === 1;

  let configurationNote: string | null = null;
  if (!sameConfiguration && repos.length > 1) {
    const differing: string[] = [];
    const first = repos[0]!.config;
    for (const repo of repos.slice(1)) {
      if (repo.config.boundary !== first.boundary) differing.push("boundary");
      if (repo.config.seed !== first.seed) differing.push("seed");
      if (repo.config.weights.cohesion !== first.weights.cohesion) differing.push("cohesion weight");
      if (repo.config.weights.coupling !== first.weights.coupling) differing.push("coupling weight");
      if (repo.config.squashK !== first.squashK) differing.push("cohesion squash");
      if (repo.config.maxGroupSize !== first.maxGroupSize) differing.push("max group size");
    }
    const unique = [...new Set(differing)].sort();
    configurationNote =
      unique.length > 0
        ? `These runs do not share one configuration — ${unique.join(", ")} differ, so the comparison is not controlled.`
        : "These runs differ in a recorded configuration field, so the comparison is not controlled.";
  }

  return { repos, sameConfiguration, configurationNote };
}
