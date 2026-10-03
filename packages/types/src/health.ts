/**
 * Canonical code-health wire contract — shared by the web dashboard
 * (`packages/web`), the shared UI (`packages/ui`), the hosted frontend, and
 * the bot. Mirrors the server's `routers/code_health.py` response shapes plus
 * the band/distribution "currency" layer.
 *
 * Before this module the health types lived web-locally in
 * `packages/web/src/lib/api/code-health.ts`; they were migrated here so every
 * consumer reads one contract.
 *
 * Band cutoffs are the SINGLE TypeScript mirror of the canonical Python source
 * in `packages/core/src/repowise/core/analysis/health/grading.py`. The two are
 * kept in sync by a parity test (`__tests__/health/band-cutoffs.test.ts` here,
 * `tests/unit/health/test_grading.py` in core). Do not hardcode `4`/`8` band
 * cutoffs anywhere else — derive from these consts or read the API `band`.
 */

import type { C4IoKind } from "./external-systems.js";

/* ------------------------------------------------------------------ *
 * Health dimensions (the three-signal split)
 * ------------------------------------------------------------------ */

/**
 * The orthogonal health signals. `defect` is the historical, calibrated score
 * surfaced as the overall number; `maintainability` is a co-surfaced signal
 * made of the smells the defect calibration floors (they don't predict bugs, so
 * they get a proper home here instead of diluting the defect score);
 * `performance` is the co-surfaced third signal: static performance RISK
 * (I/O-in-loop / N+1 shapes that waste work). All three are co-equal views; the
 * overall number stays the defect score and is never a blend.
 *
 * Mirror of `DIMENSIONS` in
 * `packages/core/src/repowise/core/analysis/health/scoring.py`, kept in sync by
 * a parity test (`__tests__/health.test.ts` here,
 * `tests/unit/health/test_scoring_dimensions.py` in core).
 */
type HealthDimension = "defect" | "maintainability" | "performance";

/** Canonical dimension order (parity-locked against core's `DIMENSIONS`). */
export const HEALTH_DIMENSIONS: readonly HealthDimension[] = [
  "defect",
  "maintainability",
  "performance",
] as const;

/**
 * Human-readable labels for the I/O-boundary kind a performance finding crosses
 * (the `boundary_kind` on an `io_in_loop` finding's `details`). The kind set is
 * the canonical `C4IoKind` from `external-systems.ts`, parity-locked against the
 * Python `IO_KINDS` classifier; this only adds display strings, no new wire
 * enum. Used to render "a database call runs once per loop iteration" detail.
 */
export const PERF_BOUNDARY_LABEL: Record<C4IoKind, string> = {
  db: "Database",
  network: "Network",
  filesystem: "Filesystem",
  subprocess: "Subprocess",
  lock: "Lock",
};

/* ------------------------------------------------------------------ *
 * Band "currency" layer
 * ------------------------------------------------------------------ */

/**
 * The 3 defect-backed health buckets. Alert files carry roughly 17x the
 * defect rate of Healthy files on our calibration corpus, so the boundaries
 * are empirically defensible rather than arbitrary. This replaces the legacy
 * ad-hoc 4-band labeling (`critical/poor/fair/good`).
 */
export type HealthBand = "healthy" | "warning" | "alert";

/** Score at or above this is Healthy. */
export const HEALTHY_MIN = 8.0;
/** Score below this is Alert; `[ALERT_MAX, HEALTHY_MIN)` is Warning. */
export const ALERT_MAX = 4.0;

export const HEALTH_BAND_LABEL: Record<HealthBand, string> = {
  healthy: "Healthy",
  warning: "Warning",
  alert: "Alert",
};

/**
 * Pure score -> band mapping. Mirror of `grading.band_for` in core. Prefer the
 * API-provided `band` where available; use this only when deriving locally.
 */
export function bandForScore(score: number): HealthBand {
  if (score < ALERT_MAX) return "alert";
  if (score < HEALTHY_MIN) return "warning";
  return "healthy";
}

interface HealthBandShare {
  /** Number of files in this band. */
  files: number;
  /** Sum of NLOC across the files in this band. */
  nloc: number;
  /** NLOC-weighted share of the repo in this band, 0-100. */
  pct: number;
}

/**
 * NLOC-weighted distribution of files across the 3 bands. The repo-level
 * "health distribution" surfaced on the dashboard + badge.
 */
export interface HealthDistribution {
  total_files: number;
  total_nloc: number;
  bands: Record<HealthBand, HealthBandShare>;
}

/* ------------------------------------------------------------------ *
 * Defect-accuracy ("does the score find the bugs?") — migrated from
 * packages/ui so the overview response can reference it without ui depending
 * back into web. `packages/ui` re-exports these for component prop typing.
 * ------------------------------------------------------------------ */

interface DefectAccuracyFile {
  file_path: string;
  score: number;
  recent_fixes: number;
}

interface DefectAccuracyPoint {
  k: number;
  hits: number;
}

export interface DefectAccuracy {
  k: number;
  hits: number;
  precision: number;
  base_rate: number;
  lift: number | null;
  window_days: number;
  scored_files: number;
  defect_files: number;
  concentration_file_fraction: number;
  concentration_defect_share: number;
  precision_table: DefectAccuracyPoint[];
  flagged_files: DefectAccuracyFile[];
}

/* ------------------------------------------------------------------ *
 * Per-file signals (process / people / topology)
 * ------------------------------------------------------------------ */

/**
 * The per-file signals we already compute and persist, consolidated into one
 * captioned contract. Every field is `null` when its source row is absent so
 * consumers render an honest "no signal" rather than a misleading zero — a
 * git-tracked file with no bug-fixes reports `prior_defect_count: 0`, whereas
 * a file with no git history reports `null` for the whole process/people group.
 * `change_entropy_pct` is on a 0-100 scale (the stored column is 0-1).
 * Topology degree is `null` when the file is not a graph node.
 */
export interface FileSignals {
  // Process — how the file changes over time.
  prior_defect_count: number | null;
  change_entropy_pct: number | null;
  lines_added_90d: number | null;
  lines_deleted_90d: number | null;
  commit_count_90d: number | null;
  age_days: number | null;
  // People — who owns it recently vs over its whole life.
  primary_owner_name: string | null;
  primary_owner_commit_pct: number | null;
  recent_owner_name: string | null;
  recent_owner_commit_pct: number | null;
  // Topology — how connected it is in the dependency graph.
  in_degree: number | null;
  out_degree: number | null;
  // Defect history — how often this file gets bug-fixed, and where in it.
  // `bug_magnet` is the decayed fix mass past its trigger, so it is a recency
  // claim: any copy that shows it must show `last_fix_at` too.
  // `fix_symbol_counts` maps symbol_id to how many recent fixes landed in it,
  // top few only, already sorted by count.
  bug_magnet: boolean | null;
  last_fix_at: string | null;
  fix_symbol_counts: Record<string, number> | null;
}

/* ------------------------------------------------------------------ *
 * Per-file trajectory
 * ------------------------------------------------------------------ */

/** One file's score at one snapshot. */
interface FileTrendPoint {
  taken_at: string | null;
  score: number;
}

/**
 * A single file's score-over-time series plus the deltas worth surfacing.
 * `points` is oldest-first and **empty when fewer than two snapshots carry
 * the file** — consumers render a "no history yet" state rather than a
 * misleading single dot. `current`/`previous`/`delta`/`declining` are null/
 * false in that case. `snapshot_count` is the whole repo window size, so a
 * young repo is distinguishable from a file absent in older snapshots.
 */
export interface FileHealthTrend {
  file_path: string;
  points: FileTrendPoint[];
  current: number | null;
  previous: number | null;
  delta: number | null;
  declining: boolean;
  snapshot_count: number;
}

/* ------------------------------------------------------------------ *
 * Churn x complexity quadrant (the "hotspot anatomy" view)
 * ------------------------------------------------------------------ */

/**
 * One file in the churn x complexity plane. `commit_count_90d` is the churn
 * (x) axis, `max_ccn` the complexity (y) axis, `nloc` encodes dot size, and
 * `score` drives dot color via the health band. `churn_percentile` (0-100) is
 * repo-relative tooltip context so a raw count reads sensibly across repos of
 * any size. Only files with recent churn (`commit_count_90d > 0`) are plotted.
 */
export interface ChurnComplexityPoint {
  file_path: string;
  commit_count_90d: number;
  max_ccn: number;
  nloc: number;
  score: number;
  churn_percentile: number;
}
