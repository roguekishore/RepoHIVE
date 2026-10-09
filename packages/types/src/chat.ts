

/** `get_overview` — repository fact sheet. */
interface OverviewArtifactData {
  total_files: number;
  total_symbols: number;
  languages: Record<string, number>;
  modules: string[];
  entry_points: string[];
  hotspot_count: number;
  git_summary?: Record<string, unknown> | null;
  is_monorepo: boolean;
}
interface OverviewArtifact {
  type: "overview";
  data: OverviewArtifactData;
}

/** `get_context` — per-target wiki snippet + git/decision context. */
interface ContextArtifactData {
  targets: Record<
    string,
    {
      docs?: { content_md?: string; title?: string; page_type?: string; page_id?: string } | null;
      hotspot_info?: Record<string, unknown> | null;
      decisions?: Array<Record<string, unknown>>;
      [k: string]: unknown;
    }
  >;
}
interface ContextArtifact {
  type: "context";
  data: ContextArtifactData;
}

/** `get_risk` — modification risk report per target. */
interface RiskReportArtifactData {
  targets: Array<{
    file_path: string;
    churn_percentile?: number;
    is_hotspot?: boolean;
    [k: string]: unknown;
  }>;
  global_hotspots: Array<{ path: string; churn_percentile: number }>;
}
interface RiskReportArtifact {
  type: "risk_report";
  data: RiskReportArtifactData;
}

/** `search_codebase` — wiki page hits. */
interface SearchResultsArtifactData {
  query: string;
  results: Array<{
    title: string;
    page_type: string;
    page_id?: string;
    target_path?: string;
    snippet?: string;
    relevance_score?: number;
  }>;
}
interface SearchResultsArtifact {
  type: "search_results";
  data: SearchResultsArtifactData;
}

/** `get_dependency_path` — short import-graph path. */
interface GraphPathArtifactData {
  path: string[];
  distance: number;
  explanation: string;
}
export interface GraphPathArtifact {
  type: "graph";
  data: GraphPathArtifactData;
}

/** `get_why` — decision register search results / health dashboard. */
interface DecisionsArtifactData {
  mode: "health" | "search";
  query?: string;
  total_decisions?: number;
  by_source?: Record<string, number>;
  decisions?: Array<{ title: string; status?: string }>;
  results?: Array<{
    title: string;
    decision: string;
    rationale?: string;
    affected_files?: string[];
  }>;
}
interface DecisionsArtifact {
  type: "decisions";
  data: DecisionsArtifactData;
}

/** `get_dead_code` — confidence-tiered dead-code findings. */
interface DeadCodeArtifactData {
  total_findings: number;
  deletable_lines: number;
  high_confidence: Array<{
    file_path: string;
    symbol_name?: string | null;
    kind: string;
    confidence: number;
    reason: string;
    lines: number;
    safe_to_delete: boolean;
  }>;
  medium_confidence: Array<{
    file_path: string;
    symbol_name?: string | null;
    kind: string;
    confidence: number;
    reason: string;
  }>;
}
export interface DeadCodeArtifact {
  type: "dead_code";
  data: DeadCodeArtifactData;
}

/** `get_architecture_diagram` — Mermaid flowchart. */
interface DiagramArtifactData {
  diagram_type: string;
  mermaid_syntax: string;
  description?: string;
}
export interface DiagramArtifact {
  type: "diagram";
  data: DiagramArtifactData;
}

/**
 * Fallback for tools that haven't yet been promoted to a typed variant.
 * The renderer falls back to JSON pretty-print for this case.
 */
export interface GenericArtifact {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Typed variants only — use this when a consumer needs to narrow on `.type`
 * and access the per-variant `data` shape. The renderer's `switch` exhaust
 * check should be against this type.
 */
export type KnownChatArtifact =
  | OverviewArtifact
  | ContextArtifact
  | RiskReportArtifact
  | SearchResultsArtifact
  | GraphPathArtifact
  | DecisionsArtifact
  | DeadCodeArtifact
  | DiagramArtifact;

/**
 * Full union accepted on the wire. Consumers should branch on
 * `isKnownChatArtifact(a)` first, then switch on `a.type` for a typed render
 * path; the `else` falls through to a JSON pretty-print.
 */
export type ChatArtifact = KnownChatArtifact | GenericArtifact;
