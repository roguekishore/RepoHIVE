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
export {
  displayNumber,
  displayPercent,
  elidePackage,
  middleElide,
} from "./format";
export {
  DECISION_TOKEN,
  DecisionGlyph,
  DecisionLegend,
  DecisionMarkShape,
  DecisionPill,
} from "./decision-mark";
export { DecisionScatter } from "./decision-scatter";
export { BoundaryStrip } from "./boundary-strip";
export { ProvenanceCard } from "./provenance-card";
export { AdaptivityComparison } from "./adaptivity-comparison";
export type { AdaptivityRepoView } from "./adaptivity-comparison";
export { Fragmentation } from "./fragmentation";
export type { FragmentedRegionView } from "./fragmentation";
export { LevelFlow } from "./level-flow";
export type { LevelFlowRowData } from "./level-flow";
export { GroupDsm } from "./group-dsm";
export type { DsmEntryView, DsmGroupView } from "./group-dsm";
export { DeterminismPanel } from "./determinism-panel";
export type { DeterminismPanelProps } from "./determinism-panel";
export { HierarchySunburst } from "./hierarchy-sunburst";
export type { SunburstArc } from "./hierarchy-sunburst";
export { RegionMorph } from "./region-morph";
export type { MorphCell, MorphEdge, MorphFile } from "./region-morph";
