import type { Decision } from "../../components/status";
import type { ViewBodies } from "../../contracts";

/** One region's recorded decision, as `region-decisions` publishes it. */
export type Region = ViewBodies["regionDecisions"]["regions"][number];

/**
 * A region the engine never measured: it scored 0 by rule (too small, or no dependencies inside it) and was rebuilt
 * without an assessment. The index has no flag for it; this is the engine's own test, the one the adaptivity view uses
 * to count them.
 */
export function isUnassessed(region: Pick<Region, "score" | "cohesion">): boolean {
  return region.score === 0 && region.cohesion === 0;
}

/** What the engine decided: kept their package, rebuilt from dependencies, or never assessed. */
export function decisionOf(region: Region): Decision {
  if (isUnassessed(region)) return "unassessed";
  return region.action === "preserve" ? "kept" : "rebuilt";
}

export function assessedRegions(regions: readonly Region[]): Region[] {
  return regions.filter((region) => !isUnassessed(region));
}

const byName = (a: Region, b: Region): number =>
  a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0;

/** Most files first; the name breaks ties, so the order is the same on every run. */
export function largestRegions(regions: readonly Region[], limit: number): Region[] {
  return [...regions].sort((a, b) => b.fileCount - a.fileCount || byName(a, b)).slice(0, limit);
}

/** Regions whose recorded score lies nearest the recorded boundary, nearest first. Orders only; no distance is shown. */
export function closestToBoundary(regions: readonly Region[], boundary: number, limit: number): Region[] {
  return [...regions]
    .sort((a, b) => Math.abs(a.score - boundary) - Math.abs(b.score - boundary) || b.fileCount - a.fileCount || byName(a, b))
    .slice(0, limit);
}

/** Whether a region's recorded score lies within this distance of the boundary: the Decisions "Close calls" filter. */
export const CLOSE_CALL_WIDTH = 0.05;

export function isCloseCall(region: Region, boundary: number): boolean {
  return Math.abs(region.score - boundary) < CLOSE_CALL_WIDTH;
}

export interface ScoreBin {
  /** Lower edge of the bin. */
  readonly from: number;
  readonly kept: number;
  readonly rebuilt: number;
}

/**
 * Counts of assessed regions per score bin, split by the recorded action. A score of 1 falls in the last bin.
 * These are tallies of recorded values, not new metrics.
 */
export function scoreBins(regions: readonly Region[], binCount = 20): ScoreBin[] {
  const bins = Array.from({ length: binCount }, (_, index) => ({ from: index / binCount, kept: 0, rebuilt: 0 }));
  for (const region of assessedRegions(regions)) {
    const bin = bins[Math.min(binCount - 1, Math.max(0, Math.floor(region.score * binCount)))];
    if (bin === undefined) continue;
    if (region.action === "preserve") bin.kept += 1;
    else bin.rebuilt += 1;
  }
  return bins;
}

export interface DecisionTally {
  readonly kept: number;
  readonly rebuilt: number;
}

/** How many assessed regions were kept and rebuilt, counted from the recorded actions. */
export function tallyAssessed(regions: readonly Region[]): DecisionTally {
  let kept = 0;
  let rebuilt = 0;
  for (const region of assessedRegions(regions)) {
    if (region.action === "preserve") kept += 1;
    else rebuilt += 1;
  }
  return { kept, rebuilt };
}

export interface ModuleTally {
  readonly name: string;
  readonly kept: number;
  readonly rebuilt: number;
}

/**
 * Recorded decisions of the assessed regions, tallied by top-level module: the first dotted segment of the name once
 * `prefix` is removed. Largest module first, the name breaking ties. A tally of recorded actions; nothing is recomputed.
 */
export function tallyByModule(regions: readonly Region[], prefix: string, limit: number): ModuleTally[] {
  const modules = new Map<string, { kept: number; rebuilt: number }>();
  for (const region of assessedRegions(regions)) {
    const shown = prefix !== "" && region.displayName.startsWith(prefix) ? region.displayName.slice(prefix.length) : region.displayName;
    const name = shown.split(".")[0] ?? shown;
    const entry = modules.get(name) ?? { kept: 0, rebuilt: 0 };
    if (region.action === "preserve") entry.kept += 1;
    else entry.rebuilt += 1;
    modules.set(name, entry);
  }
  return [...modules.entries()]
    .map(([name, tally]) => ({ name, ...tally }))
    .sort((a, b) => b.kept + b.rebuilt - (a.kept + a.rebuilt) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, limit);
}
