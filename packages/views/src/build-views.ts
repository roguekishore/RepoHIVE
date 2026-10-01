/**
 * Every view a snapshot publishes (hosting-2 Requirement 6.2), built from the
 * grouping output without reading the index back. Pure: no clock, filesystem or
 * randomness, so the same input gives the same values and, serialised with
 * `JSON.stringify`, the same bytes (Requirement 6.5).
 *
 * The object layout (which key holds which view) belongs to the indexer; this
 * returns the values by role.
 */
import type { GroupingOutput } from "@repohive/core";
import { buildAdaptivityView, countFiles } from "./adaptivity-view.js";
import { availableArchitectureLevels, buildArchitectureView } from "./architecture-view.js";
import { buildBlastRadiusData, type BlastRadiusData } from "./blast-radius-view.js";
import { fromGroupingOutput, type ViewIndex } from "./from-grouping-output.js";
import { buildGraphView } from "./graph-view.js";
import { adaptHierarchyScale } from "./hierarchy-scale-adapter.js";
import { adaptRegionDetail } from "./region-detail-adapter.js";
import { buildRegionDecisionsView } from "./region-decisions-view.js";
import { buildRepoView, type RepoEntry } from "./repo-view.js";
import { adaptIndexToZoomMap } from "./zoom-map-adapter.js";

export interface SnapshotViews {
  repo: ReturnType<typeof buildRepoView>;
  graph: ReturnType<typeof buildGraphView>;
  adaptivity: ReturnType<typeof buildAdaptivityView>;
  hierarchyScale: ReturnType<typeof adaptHierarchyScale>;
  regionDecisions: ReturnType<typeof buildRegionDecisionsView>;
  zoomMap: ReturnType<typeof adaptIndexToZoomMap>;
  /** No `level`: the adapter's default DSM level. */
  architecture: ReturnType<typeof buildArchitectureView>;
  /** One per `availableLevels` entry of `architecture`, in that order. */
  architectureLevels: ReturnType<typeof buildArchitectureView>[];
  /** One per entry of `metadata.regionDecisions`, in that order. */
  regionDetails: NonNullable<ReturnType<typeof adaptRegionDetail>>[];
  /** `regionId` to its position in `regionDetails`. */
  regionDetailIndex: Record<string, number>;
  blastRadius: BlastRadiusData;
}

/** `entry` stands in for the local repository registry entry the routes read (repository summary, zoom map name, adaptivity). */
export function buildSnapshotViews(output: GroupingOutput, entry: RepoEntry): SnapshotViews {
  return buildSnapshotViewsFromIndex(fromGroupingOutput(output), entry);
}

/** The same views from an index already in `parseIndex` shape (what the equality test feeds it). */
export function buildSnapshotViewsFromIndex({ hierarchy, metadata }: ViewIndex, entry: RepoEntry): SnapshotViews {

  const architecture = buildArchitectureView(hierarchy, metadata);
  const architectureLevels = availableArchitectureLevels(metadata).map((row) =>
    buildArchitectureView(hierarchy, metadata, row.level),
  );

  const regionDetails: SnapshotViews["regionDetails"] = [];
  const regionDetailIndex: Record<string, number> = {};
  for (const decision of metadata.regionDecisions) {
    const detail = adaptRegionDetail(hierarchy, metadata, decision.regionId);
    if (detail === null) {
      throw new Error(`views: no region detail for recorded region ${JSON.stringify(decision.regionId)}`);
    }
    regionDetailIndex[decision.regionId] = regionDetails.length;
    regionDetails.push(detail);
  }

  return {
    repo: buildRepoView(entry),
    graph: buildGraphView(hierarchy),
    adaptivity: buildAdaptivityView(
      [{ id: entry.id, name: entry.name, metadata, files: countFiles(hierarchy) }],
      [],
    ),
    hierarchyScale: adaptHierarchyScale(hierarchy, metadata),
    regionDecisions: buildRegionDecisionsView(hierarchy, metadata),
    zoomMap: adaptIndexToZoomMap(hierarchy, metadata, entry.name),
    architecture,
    architectureLevels,
    regionDetails,
    regionDetailIndex,
    blastRadius: buildBlastRadiusData(hierarchy),
  };
}
