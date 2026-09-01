/**
 * RepoHIVE-owned decision components (viewer handoff §9).
 *
 * Everything in this namespace was purpose-built for the adaptive
 * preserve-vs-reconstruct decision record; nothing here is vendored, so the
 * NOTICE attribution for the repowise folders does not cover it.
 */

export type { DecisionAction, DecisionWeights, RegionPoint, RegionView } from "./types";
export {
  boundarySegment,
  deriveRegionViews,
  effectiveActionAt,
  independenceOf,
  recomputeScore,
  squashCohesion,
  tallyViews,
} from "./decision-model";
export type { BoundaryTally } from "./decision-model";
export { DecisionScatter } from "./decision-scatter";
export type { DecisionScatterProps } from "./decision-scatter";
export { BoundaryStrip } from "./boundary-strip";
export type { BoundaryStripProps } from "./boundary-strip";
export { ProvenanceCard } from "./provenance-card";
export type { ProvenanceCardProps, ProvenanceGroupLink } from "./provenance-card";
export { RegionMorph } from "./region-morph";
export type { MorphCell, MorphEdge, MorphFile, RegionMorphProps } from "./region-morph";
