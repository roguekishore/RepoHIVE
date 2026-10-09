/**
 * Canonical graph types — file/module dependency graph plus graph-intelligence
 * surfaces (callers/callees, communities, execution flows, metrics).
 *
 * Canonical source: engine `PipelineResult.graph` (NetworkX node_link_data
 * format) and the per-symbol intelligence endpoints in
 * `packages/server/src/repowise/server/schemas.py`.
 *
 * Some downstream backends emit a looser `{ nodes, links, directed?, multigraph? }`
 * shape; consumer-side adapters are responsible for converting that to
 * `GraphExport` below before passing data to components.
 */

// ---------------------------------------------------------------------------
// Core node + link
// ---------------------------------------------------------------------------

export interface GraphNode {
  node_id: string;
  node_type: string;
  language: string;
  symbol_count: number;
  pagerank: number;
  betweenness: number;
  community_id: number;
  is_test: boolean;
  is_entry_point: boolean;
  has_doc: boolean;
  /** Cross-link signals — added in Phase A enrichment. All optional for
   *  back-compat with older backends; consumers should default to false/null. */
  is_hotspot?: boolean;
  churn_percentile?: number | null;
  is_dead?: boolean;
  dead_confidence?: number | null;
  has_decision?: boolean;
  primary_owner?: string | null;
}

export interface GraphLink {
  source: string;
  target: string;
  imported_names: string[];
  /** Edge kind from v0.4.0 framework-aware extractors (e.g. "spring.bean", "rails.route"). */
  edge_type?: string;
  /** Confidence score for resolved symbol-level call edges (v0.4.x). */
  confidence?: number;
}

export interface GraphExport {
  nodes: GraphNode[];
  links: GraphLink[];
  /** Server flagged response as capped (PageRank fill + reserved dead/hot/flow
   *  slots). UI should banner. */
  truncated?: boolean;
  total_node_count?: number;
  /** Signal-overlay counts: repo-wide totals vs how many nodes are in this
   *  response. Lets the UI say "12 of 37 dead files in view" and distinguish
   *  "none in the repo" from "none in the loaded view". Optional — older
   *  backends and endpoints that don't compute them omit these. */
  dead_total?: number | null;
  dead_in_view?: number | null;
  hot_total?: number | null;
  hot_in_view?: number | null;
}

// ---------------------------------------------------------------------------
// Architecture (community super-node) graph
// ---------------------------------------------------------------------------

export interface ArchitectureNode {
  community_id: number;
  label: string;
  cohesion: number;
  member_count: number;
  top_file: string;
  avg_pagerank: number;
  hotspot_count: number;
  dead_count: number;
  has_decision: boolean;
  doc_coverage_pct: number;
  languages: string[];
}

interface ArchitectureEdge {
  source: number;
  target: number;
  edge_count: number;
}

export interface ArchitectureGraph {
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
}

// ---------------------------------------------------------------------------
// Community slice (constellation blossom — one hub's member sub-graph)
// ---------------------------------------------------------------------------

export interface CommunitySliceNode extends GraphNode {
  /** True for one-hop neighbor stubs outside the community (cross-cluster). */
  is_boundary?: boolean;
}

export interface CommunitySlice {
  nodes: CommunitySliceNode[];
  links: GraphLink[];
  community_id: number;
  member_count: number;
  truncated?: boolean;
}

// ---------------------------------------------------------------------------
// Module rollup
// ---------------------------------------------------------------------------

export interface ModuleNode {
  module_id: string;
  file_count: number;
  symbol_count: number;
  avg_pagerank: number;
  doc_coverage_pct: number;
  hotspot_count?: number;
  dead_count?: number;
  has_decision?: boolean;
  primary_owner?: string | null;
}

export interface ModuleEdge {
  source: string;
  target: string;
  edge_count: number;
}

export interface ModuleGraph {
  nodes: ModuleNode[];
  edges: ModuleEdge[];
}

// ---------------------------------------------------------------------------
// Path finder
// ---------------------------------------------------------------------------

export interface GraphPath {
  path: string[];
  distance: number;
  explanation: string;
  visual_context?: unknown;
}

/**
 * Lightweight node-search result used by the path finder autocomplete.
 * Mirrors `NodeSearchResultResponse` from the engine.
 */
export interface NodeSearchResult {
  node_id: string;
  language: string;
  symbol_count: number;
}

// ---------------------------------------------------------------------------
// Communities (Leiden — v0.4.0)
// ---------------------------------------------------------------------------

interface CommunityMember {
  path: string;
  pagerank: number;
  is_entry_point: boolean;
}

interface NeighboringCommunity {
  community_id: number;
  label: string;
  cross_edge_count: number;
}

export interface CommunityDetail {
  community_id: number;
  label: string;
  cohesion: number;
  member_count: number;
  members: CommunityMember[];
  truncated: boolean;
  neighboring_communities: NeighboringCommunity[];
}

export interface CommunitySummaryItem {
  community_id: number;
  label: string;
  cohesion: number;
  member_count: number;
  top_file: string;
}

interface ExecutionFlowEntry {
  entry_point: string;
  entry_point_name: string;
  entry_point_score: number;
  trace: string[];
  depth: number;
  crosses_community: boolean;
  communities_visited: number[];
}

export interface ExecutionFlows {
  total_entry_points: number;
  flows: ExecutionFlowEntry[];
}
