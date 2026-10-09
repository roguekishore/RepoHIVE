

export interface Hotspot {
  file_path: string;
  commit_count_total?: number;
  commit_count_90d: number;
  commit_count_30d: number;
  churn_percentile: number;
  temporal_hotspot_score?: number | null;
  primary_owner: string | null;
  /** Share of all-time commits attributable to the primary owner, 0–1. */
  primary_owner_commit_pct?: number | null;
  /** Top author in the last 90 days; may differ from primary_owner on legacy code. */
  recent_owner_name?: string | null;
  recent_owner_commit_pct?: number | null;
  is_hotspot: boolean;
  is_stable: boolean;
  bus_factor: number;
  contributor_count: number;
  lines_added_90d: number;
  lines_deleted_90d: number;
  avg_commit_size: number;
  commit_categories: Record<string, number>;
  merge_commit_count_90d?: number;
  /** True when the per-file commit-history cap was hit during indexing — i.e. older history exists but was not analysed. */
  commit_count_capped?: boolean;
  age_days?: number;
  last_commit_at?: string | null;
  /** Hassan change entropy (History Complexity Metric) — decay-weighted commit scatter. */
  change_entropy?: number;
  /** Repo-wide percentile rank of change_entropy, 0–100. */
  change_entropy_pct?: number;
  /** Bug-fix commits touching this file in the trailing defect window. */
  prior_defect_count?: number;
  /** Decayed fix mass past its trigger. A recency claim, so any copy showing
   *  it must show `last_fix_at` too. */
  bug_magnet?: boolean;
  last_fix_at?: string | null;
  /** The file's path before its most recent rename, if any. */
  original_path?: string | null;
}
