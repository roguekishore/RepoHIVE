/**
 * Pure derivations over recorded region decisions.
 *
 * The rule set is exactly the engine's (core `assessor.ts`):
 *   cohesionNorm = cohesion / (cohesion + k)          (bounded squash)
 *   independence = 1 − clamp01(coupling)
 *   score        = Σ (wᵢ / Σw) · vᵢ over the applied weights
 *   action       = score ≥ boundary → preserve, else reconstruct
 *
 * Nothing here invents a value: every input is a recorded engine output, and
 * every derived number is a re-rendering of the recorded formula so the UI can
 * show the working, not just the verdict. Where a recomputation cannot be
 * exact (a modularity weight was applied, or the engine's degenerate-region
 * rule fired), the functions say so instead of pretending.
 *
 * Deterministic: outputs are pure functions of inputs; region lists keep their
 * canonical (regionId-ascending) order.
 */

import type { DecisionAction, DecisionWeights, RegionPoint, RegionView } from "./types";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The engine's bounded cohesion squash: c / (c + k). */
export function squashCohesion(cohesion: number, squashK: number): number {
  return cohesion / (cohesion + squashK);
}

/** The engine's independence term: 1 − clamp01(coupling). */
export function independenceOf(coupling: number): number {
  return 1 - clamp01(coupling);
}

/**
 * Re-apply the engine's weighted blend from the recorded inputs, or `null`
 * when it cannot be reproduced in two dimensions (a modularity weight was
 * applied, whose per-region Q value we do not carry here).
 */
export function recomputeScore(
  cohesion: number,
  coupling: number,
  squashK: number,
  weights: DecisionWeights,
): number | null {
  if (weights.modularity !== undefined) return null;
  const total = weights.cohesion + weights.coupling;
  if (!(total > 0)) return null;
  const blended =
    (weights.cohesion / total) * squashCohesion(cohesion, squashK) +
    (weights.coupling / total) * independenceOf(coupling);
  return clamp01(blended);
}

/**
 * The action a region takes at `boundary`. The threshold governs only the
 * automatic decision; a user-overridden region is pinned to its recorded
 * action at every boundary.
 */
export function effectiveActionAt(
  region: Pick<RegionPoint, "score" | "action" | "userOverridden">,
  boundary: number,
): DecisionAction {
  if (region.userOverridden) return region.action;
  return region.score >= boundary ? "preserve" : "reconstruct";
}

/**
 * Derive the presentation view of every region at the given boundary.
 * Order is canonical: ascending `regionId`.
 */
export function deriveRegionViews(
  regions: readonly RegionPoint[],
  squashK: number,
  boundary: number,
): RegionView[] {
  return [...regions]
    .sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0))
    .map((region) => {
      const effectiveAction = effectiveActionAt(region, boundary);
      return {
        ...region,
        cohesionNorm: squashCohesion(region.cohesion, squashK),
        independence: independenceOf(region.coupling),
        effectiveAction,
        flipped: effectiveAction !== region.action,
      };
    });
}

export interface BoundaryTally {
  preserve: number;
  reconstruct: number;
  flipped: number;
}

/** Counts at the current boundary, for the strip's readout. */
export function tallyViews(views: readonly RegionView[]): BoundaryTally {
  let preserve = 0;
  let flipped = 0;
  for (const view of views) {
    if (view.effectiveAction === "preserve") preserve += 1;
    if (view.flipped) flipped += 1;
  }
  return { preserve, reconstruct: views.length - preserve, flipped };
}

/**
 * The decision boundary as a segment in (cohesionNorm, independence) space:
 * points where wc·x + wp·y = boundary·(wc + wp), clipped to the unit square.
 * Returns `null` when the line cannot be drawn exactly (modularity weight
 * present, degenerate weights, or the line misses the square entirely).
 */
export function boundarySegment(
  boundary: number,
  weights: DecisionWeights,
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (weights.modularity !== undefined) return null;
  const wc = weights.cohesion;
  const wp = weights.coupling;
  if (!(wc + wp > 0)) return null;
  const rhs = boundary * (wc + wp);

  // Intersections with the four unit-square edges, deduplicated.
  const points: Array<{ x: number; y: number }> = [];
  const push = (x: number, y: number) => {
    if (x < -1e-9 || x > 1 + 1e-9 || y < -1e-9 || y > 1 + 1e-9) return;
    const cx = clamp01(x);
    const cy = clamp01(y);
    if (!points.some((p) => Math.abs(p.x - cx) < 1e-9 && Math.abs(p.y - cy) < 1e-9)) {
      points.push({ x: cx, y: cy });
    }
  };
  if (wp !== 0) {
    push(0, rhs / wp); // x = 0 edge
    push(1, (rhs - wc) / wp); // x = 1 edge
  }
  if (wc !== 0) {
    push(rhs / wc, 0); // y = 0 edge
    push((rhs - wp) / wc, 1); // y = 1 edge
  }
  if (points.length < 2) return null;
  const [a, b] = points;
  return { x1: a!.x, y1: a!.y, x2: b!.x, y2: b!.y };
}
