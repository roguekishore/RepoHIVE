"use client";

/**
 * Shared fetch hooks + response contracts for the Decisions surface.
 *
 * One place declares what `/region-decisions` and `/region-detail` return, so
 * the strip, scatter, provenance card, morph and table all read the same
 * cached response instead of re-declaring page-local types (the old
 * decision-audit page defined these inline).
 */

import useSWR from "swr";
import type { DecisionAction, RegionPoint } from "@repohive/ui/repohive";
import type { MorphCell, MorphEdge, MorphFile } from "@repohive/ui/repohive";

const SWR_OPTS = { revalidateOnFocus: false, revalidateOnReconnect: false };

/** One region row as served by `/api/graph/{id}/region-decisions`. */
export interface RegionDecisionRow extends RegionPoint {
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
export interface RegionDetailResponse {
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

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed (${res.status}).`);
  }
  return res.json() as Promise<T>;
}

export function useRegionDecisions(repoId: string | null) {
  const { data, error, isLoading } = useSWR<RegionDecisionsResponse>(
    repoId ? `/api/graph/${repoId}/region-decisions` : null,
    fetchJson,
    SWR_OPTS,
  );
  return { audit: data, error, isLoading };
}

export function useRegionDetail(repoId: string | null, regionId: string | null) {
  const key =
    repoId && regionId
      ? `/api/graph/${repoId}/region-detail?region=${encodeURIComponent(regionId)}`
      : null;
  const { data, error, isLoading } = useSWR<RegionDetailResponse>(key, fetchJson, SWR_OPTS);
  return { detail: data, error, isLoading };
}
