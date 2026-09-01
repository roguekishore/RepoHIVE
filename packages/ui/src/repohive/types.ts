/**
 * RepoHIVE-owned view-model types for the decision surfaces.
 *
 * This namespace (`ui/src/repohive/`) holds components built for RepoHIVE
 * itself, kept apart from the vendored repowise folders so the NOTICE
 * attribution stays accurate (viewer handoff §9).
 *
 * Everything here is presentational: recorded engine values arrive via props,
 * already parsed. The only arithmetic these types admit is the engine's own
 * recorded formula (squash + weighted blend) and the boundary comparison the
 * handoff explicitly sanctions as client-side (§9 idea 2).
 */

export type DecisionAction = "preserve" | "reconstruct";

/** One region's recorded decision, exactly as the engine emitted it. */
export interface RegionPoint {
  regionId: string;
  /** Scheme-stripped display path, e.g. `org.jsoup.helper`. */
  label: string;
  /** Raw recorded cohesion (strength per node — unbounded above). */
  cohesion: number;
  /** Raw recorded coupling in [0, 1]. */
  coupling: number;
  /** Recorded structural-quality score in [0, 1]. */
  score: number;
  /** Recorded |score − boundary|. */
  decisionConfidence: number;
  action: DecisionAction;
  automaticAction: DecisionAction;
  userOverridden: boolean;
  /** File members of the region, counted from the hierarchy. */
  fileCount: number;
  /** Group node ids this decision produced (Gap 12), canonical order. */
  groupIds: string[];
}

/** A region with the derived, per-boundary presentation values. */
export interface RegionView extends RegionPoint {
  /** cohesion / (cohesion + k) — the engine's own squash, re-applied for display. */
  cohesionNorm: number;
  /** 1 − clamp01(coupling) — the engine's independence term. */
  independence: number;
  /** The action at the current (possibly counterfactual) boundary. */
  effectiveAction: DecisionAction;
  /** True when `effectiveAction` differs from the recorded `action`. */
  flipped: boolean;
}

/** The applied metric weights, as recorded in metadata. */
export interface DecisionWeights {
  cohesion: number;
  coupling: number;
  modularity?: number;
}
