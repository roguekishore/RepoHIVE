/**
 * Dependency_Weight_Calculator (Requirement 2): assign exactly one finite,
 * non-negative Dependency_Strength to every edge.
 *
 * Default weighting (design): w = a·importFrequency + b·methodCallFrequency +
 * c·sharedTypeCount with non-negative coefficients. Componentwise monotonic
 * (2.4), all-zero signals → exactly zero (2.5), deterministic (2.6).
 *
 * Phase-1 seam note: the parser currently emits methodCallFrequency = 0 and
 * sharedTypeCount = 0, so initial strengths are import-driven. The function
 * covers all three signals, so nothing changes when the parser sharpens.
 */

import type { DependencyModel, WeightedModel } from "./types.js";

export interface WeightCoefficients {
  importCoefficient: number;
  callCoefficient: number;
  sharedTypeCoefficient: number;
}

export const DEFAULT_WEIGHT_COEFFICIENTS: WeightCoefficients = {
  importCoefficient: 1,
  callCoefficient: 1,
  sharedTypeCoefficient: 1,
};

export function computeWeights(
  model: DependencyModel,
  coefficients: WeightCoefficients = DEFAULT_WEIGHT_COEFFICIENTS
): WeightedModel {
  const { importCoefficient: a, callCoefficient: b, sharedTypeCoefficient: c } = coefficients;
  const weightedEdges = model.edges.map((edge) => ({
    ...edge,
    strength: strengthOf(edge.importFrequency, edge.methodCallFrequency, edge.sharedTypeCount, a, b, c),
  }));
  return { ...model, weightedEdges };
}

function strengthOf(
  importFrequency: number,
  methodCallFrequency: number,
  sharedTypeCount: number,
  a: number,
  b: number,
  c: number
): number {
  const w = a * importFrequency + b * methodCallFrequency + c * sharedTypeCount;
  // Numeric safety: strengths are finite and ≥ 0 (2.3); malformed signal
  // values are clamped rather than propagated as NaN/Infinity.
  if (!Number.isFinite(w) || w < 0) {
    return 0;
  }
  return w;
}
