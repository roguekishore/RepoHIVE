/**
 * The view bodies a snapshot publishes. Type-only: the shapes come from `@repohive/views`, which builds them, so a
 * change there is a compile error here instead of a surprise at run time.
 */
import type { SnapshotViews } from "@repohive/views";

/** The views stored once per snapshot, by role. */
export const VIEW_NAMES = [
  "repo",
  "graph",
  "adaptivity",
  "hierarchyScale",
  "regionDecisions",
  "zoomMap",
  "architecture",
  "blastRadius",
] as const;

export type ViewName = (typeof VIEW_NAMES)[number];

export type ViewBodies = Pick<SnapshotViews, ViewName>;

/** The architecture view at one level; `n` is the position in `architecture.availableLevels`. */
export type ArchitectureLevelView = SnapshotViews["architectureLevels"][number];

/** One region's detail, and the index that maps a region id to its position. */
export type RegionDetailView = SnapshotViews["regionDetails"][number];
export type RegionDetailIndex = SnapshotViews["regionDetailIndex"];
