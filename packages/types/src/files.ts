

/**
 * One slim row in the browsable Files index (`GET /api/repos/{id}/files`).
 * Everything the treemap + ranked table need without the per-file aggregate's
 * weight. `pagerank_pct` / `churn_pct` are 0-100 percentiles ranked over the
 * whole repo; scores are 0-10; nullable fields read "—" when unmeasured.
 */
interface FileRow {
  file_path: string;
  language: string;
  loc: number | null;
  symbol_count: number;
  pagerank_pct: number;
  in_degree: number;
  out_degree: number;
  defect_score: number | null;
  maintainability_score: number | null;
  performance_score: number | null;
  churn_pct: number | null;
  commit_count: number | null;
  last_commit_at: string | null;
  coverage_pct: number | null;
  is_test: boolean;
  is_entry_point: boolean;
  community_id: number;
}

interface FileLanguageCount {
  language: string;
  count: number;
}

export interface FilesIndexResponse {
  files: FileRow[];
  total: number;
  languages: FileLanguageCount[];
}
