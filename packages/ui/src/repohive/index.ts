/**
 * RepoHIVE-owned decision components (viewer handoff §9).
 *
 * Everything in this namespace was purpose-built for the adaptive
 * preserve-vs-reconstruct decision record; nothing here is vendored, so the
 * NOTICE attribution for the repowise folders does not cover it.
 */

export type {
  DecisionAction,
  DecisionState,
  DecisionWeights,
  RegionPoint,
  RegionView,
} from "./types";
export {
  assessedPreserveShare,
  boundarySegment,
  deriveRegionViews,
  effectiveActionAt,
  independenceOf,
  isDegenerate,
  recomputeScore,
  squashCohesion,
  tallyViews,
} from "./decision-model";
export type { BoundaryTally } from "./decision-model";
export {
  DISPLAY_DECIMALS,
  displayNumber,
  displayPercent,
  elidePackage,
  middleElide,
} from "./format";
export {
  DECISION_GLOSS,
  DECISION_LABEL,
  DECISION_TOKEN,
  DecisionGlyph,
  DecisionLegend,
  DecisionMarkShape,
  DecisionPill,
} from "./decision-mark";
export { DecisionScatter } from "./decision-scatter";
export type { DecisionScatterProps } from "./decision-scatter";
export { BoundaryStrip } from "./boundary-strip";
export type { BoundaryStripProps } from "./boundary-strip";
export { ProvenanceCard } from "./provenance-card";
export type { ProvenanceCardProps, ProvenanceGroupLink } from "./provenance-card";
export { AdaptivityComparison, ScoreSpread } from "./adaptivity-comparison";
export type { AdaptivityComparisonProps, AdaptivityRepoView } from "./adaptivity-comparison";
export { RegionMorph } from "./region-morph";
export type { MorphCell, MorphEdge, MorphFile, RegionMorphProps } from "./region-morph";
