/**
 * Shapes the views produce for the viewer, mirrored structurally from
 * `@repohive/ui` (`zoom/types.ts`, `repohive/region-morph.tsx`) and
 * `@repohive/api-client` (`RepoResponse`) so this package imports neither: it
 * must not depend on React, Next.js or the UI tree. `packages/web` passes the
 * results to the UI components, which type-checks the two sides against each
 * other.
 */

// --- zoom map (`@repohive/ui/zoom`) ---

/** Node kinds, coarsest to finest. A leaf is always `file`. */
export type ZoomKind = "system" | "layer" | "group" | "folder" | "file";

/** A child's allocation inside its parent, in parent `[0,1]` space. */
export interface ZoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Counts rolled up over a node's subtree (a file is its own subtree). */
export interface ZoomMetrics {
  file_count: number;
  descendant_count: number;
  hotspot_count: number;
  dead_count: number;
  entry_point_count: number;
  on_flow_count: number;
}

export interface ZoomNode {
  id: string;
  parent_id: string | null;
  level: number;
  kind: ZoomKind;
  name: string;
  path: string;
  children: string[];
  importance: number;
  sibling_rank: number;
  metrics: ZoomMetrics;
  layout: ZoomRect | null;
  summary: string;
  language: string | null;
  health_score: number | null;
  is_entry_point: boolean;
  is_hotspot: boolean;
  is_dead: boolean;
  is_test: boolean;
  on_flow: boolean;
  decision?: "preserve" | "reconstruct" | null;
}

/** An aggregated edge between two sibling subtrees under a shared parent. */
export interface ZoomRelation {
  parent_id: string;
  source_id: string;
  target_id: string;
  label: string;
  edge_count: number;
  coupling: string;
}

export interface ZoomMap {
  root_id: string;
  project_name: string;
  total_files: number;
  max_depth: number;
  truncated: boolean;
  nodes: ZoomNode[];
  relations: ZoomRelation[];
}

// --- region morph (`@repohive/ui/repohive`) ---

export interface MorphFile {
  id: string;
  name: string;
  packagePath: string;
}

export interface MorphCell {
  id: string;
  label: string;
  fileIds: string[];
}

export interface MorphEdge {
  source: string;
  target: string;
  strength: number;
}

// --- repository summary (`@repohive/api-client` `RepoResponse`) ---

export interface RepoSummary {
  id: string;
  name: string;
  url: string;
  local_path: string;
  default_branch: string;
  head_commit: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  workspace_status: "indexed";
  docs_mode: "none";
}
