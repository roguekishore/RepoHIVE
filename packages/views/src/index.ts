/**
 * @repohive/views: the viewer's response bodies as pure functions of a parsed
 * index (hosting-2 Requirement 6). Moved out of `packages/web` without
 * behaviour change so the hosted indexer can build every view at index time.
 *
 * Depends on `@repohive/core` only: no Next.js, no React.
 */
// The constant `VIEWS_VERSION` is `@repohive/views/views-version`: importing it reads the file at once.
export { getViewsVersion } from "./views-version.js";
export { fromGroupingOutput } from "./from-grouping-output.js";
export type { ViewIndex } from "./from-grouping-output.js";
export { buildSnapshotViews, buildSnapshotViewsFromIndex } from "./build-views.js";
export type { SnapshotViews } from "./build-views.js";

// One builder per route body.
export { buildRepoView } from "./repo-view.js";
export type { RepoEntry } from "./repo-view.js";
export { buildGraphView } from "./graph-view.js";
export type { GraphView, GraphViewLink, GraphViewNode } from "./graph-view.js";
export { buildAdaptivityView, countFiles } from "./adaptivity-view.js";
export { buildArchitectureView, availableArchitectureLevels } from "./architecture-view.js";
export { buildRegionDecisionsView } from "./region-decisions-view.js";
export { buildBlastRadiusData, computeBlastRadius } from "./blast-radius-view.js";
export type { BlastRadiusData, BlastRadiusResult } from "./blast-radius-view.js";

// The adapters the routes and the builders share.
export { adaptAdaptivity } from "./adaptivity-adapter.js";
export type { AdaptivityInput } from "./adaptivity-adapter.js";
export {
  DSM_BUDGET,
  adaptDeterminism,
  adaptFragmentation,
  adaptGroupDsm,
  adaptLevelFlow,
  chooseDsmLevel,
} from "./architecture-adapter.js";
export { adaptHierarchyScale } from "./hierarchy-scale-adapter.js";
export { adaptRegionDetail, regionFileMembership, stripRegionScheme } from "./region-detail-adapter.js";
export type { RegionDetail } from "./region-detail-adapter.js";
export { adaptIndexToZoomMap } from "./zoom-map-adapter.js";
export { buildDisplayLabels, buildGroupPackagePrefixes, fileSimpleName } from "./zoom-labels.js";
export type * from "./ui-types.js";
