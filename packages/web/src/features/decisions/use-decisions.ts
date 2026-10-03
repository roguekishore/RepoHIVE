"use client";

/**
 * Shared fetch hooks + response contracts for the Decisions surface.
 *
 * One place declares what `/region-decisions` and `/region-detail` return, so
 * the strip, scatter, provenance card, morph and table all read the same
 * cached response instead of re-declaring page-local types (the old
 * decision-audit page defined these inline).
 */

import type { DecisionAction, RegionPoint } from "./types";
import type { MorphCell, MorphEdge, MorphFile } from "./region-morph";
import { useSnapshotJson } from "@/features/repository/snapshot-context";

/** One region row as served by `/api/graph/{id}/region-decisions`. */
interface RegionDecisionRow extends RegionPoint {
  displayName: string;
  modularity?: number;
}

export interface RegionDecisionsResponse {
  boundary: number;
  metricWeights: { cohesion: number; coupling: number; modularity?: number };
  cohesionSquashConstant: number;
  seed: number | null;
  regionCount: number;
  regions: Array<Omit<RegionDecisionRow, "label"> & { label?: string }>;
}

/** `/api/graph/{id}/region-detail?region=…` — the morph/provenance payload. */
interface RegionDetailResponse {
  regionId: string;
  displayName: string;
  decision: {
    regionId: string;
    cohesion: number;
    coupling: number;
    modularity?: number;
    score: number;
    action: DecisionAction;
    automaticAction: DecisionAction;
    userOverridden: boolean;
    decisionConfidence: number;
    groupIds?: string[];
  };
  boundary: number;
  metricWeights: { cohesion: number; coupling: number; modularity?: number };
  cohesionSquashConstant: number;
  seed: number | null;
  files: MorphFile[];
  authored: MorphCell[];
  derived: MorphCell[];
  edges: MorphEdge[];
  truncatedFiles: number;
}

export function useRegionDecisions(repoId: string | null) {
  const { data, error, isLoading } = useSnapshotJson<RegionDecisionsResponse>(
    repoId ? "views/region-decisions.json" : null,
  );
  return { audit: data, error, isLoading };
}

/**
 * One region's detail. The snapshot publishes one file per region plus an index
 * from region id to file position, so this reads the index first.
 */
export function useRegionDetail(repoId: string | null, regionId: string | null) {
  const wanted = repoId !== null && regionId !== null;
  const index = useSnapshotJson<Record<string, number>>(wanted ? "views/region-detail-index.json" : null);
  const position = wanted && index.data ? index.data[regionId] : undefined;
  const detail = useSnapshotJson<RegionDetailResponse>(
    position === undefined ? null : `views/region-detail/${position}.json`,
  );
  const unknown = wanted && index.data !== undefined && position === undefined;
  return {
    detail: detail.data,
    error: unknown ? new Error(`No recorded decision for region '${regionId}'.`) : (index.error ?? detail.error),
    isLoading: wanted && !unknown && detail.data === undefined && !(index.error ?? detail.error),
  };
}
