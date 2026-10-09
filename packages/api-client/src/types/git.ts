// ---------------------------------------------------------------------------
// Git Intelligence
// ---------------------------------------------------------------------------

export interface GitMetadataResponse {
  file_path: string;
  commit_count_total: number;
  commit_count_90d: number;
  commit_count_30d: number;
  first_commit_at: string | null;
  last_commit_at: string | null;
  primary_owner_name: string | null;
  primary_owner_email: string | null;
  primary_owner_commit_pct: number | null;
  recent_owner_name: string | null;
  recent_owner_commit_pct: number | null;
  top_authors: Array<{ name: string; email: string; commit_count: number; pct: number }>;
  significant_commits: Array<{ sha: string; date: string; message: string; author: string }>;
  co_change_partners: Array<{ file_path: string; co_change_count: number }>;
  is_hotspot: boolean;
  is_stable: boolean;
  churn_percentile: number;
  age_days: number;
  bus_factor: number;
  contributor_count: number;
  lines_added_90d: number;
  lines_deleted_90d: number;
  avg_commit_size: number;
  commit_categories: Record<string, number>;
  merge_commit_count_90d: number;
  change_entropy?: number;
  change_entropy_pct?: number;
  prior_defect_count?: number;
  /** `symbol_id` -> counted fixes that landed in it, same window as
   *  `prior_defect_count`. Approximate: symbol spans are current-tree while
   *  each fix's ranges are numbered on its own parent commit. */
  fix_symbol_counts?: Record<string, number>;
  bug_magnet?: boolean;
  last_fix_at?: string | null;
  temporal_hotspot_score?: number | null;
  commit_count_capped?: boolean;
  original_path?: string | null;
  test_gap?: boolean | null;
  // Agent-provenance rollup (deterministic local-git channels). The pct is
  // null/absent for indexes built before the provenance-aware walk.
  agent_commit_count?: number;
  agent_authored_pct?: number | null;
  agent_tier_counts?: Record<string, number>;
}
