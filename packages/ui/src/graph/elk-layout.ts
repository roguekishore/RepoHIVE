/**
 * ELK layout engine — computes node positions for the Sigma canvas.
 *
 * Uses elkjs for deterministic hierarchical layout with compound nodes
 * representing directories.
 */

import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode, ElkExtendedEdge } from "elkjs";
import type {
  GraphNode as GraphNodeResponse,
  GraphLink as GraphEdgeResponse,
} from "@repohive/types/graph";
const FILE_NODE_WIDTH = 140;
const FILE_NODE_HEIGHT = 36;

const elk = new ELK();

// ---- Types ----

export interface FileNodeData {
  nodeType: "file";
  label: string;
  fullPath: string;
  language: string;
  symbolCount: number;
  pagerank: number;
  betweenness: number;
  communityId: number;
  isTest: boolean;
  isEntryPoint: boolean;
  hasDoc: boolean;
  isHotspot?: boolean | undefined;
  isDead?: boolean | undefined;
  [key: string]: unknown;
}

export interface ModuleNodeData {
  nodeType: "module";
  label: string;
  fullPath: string;
  fileCount: number;
  symbolCount: number;
  avgPagerank: number;
  docCoveragePct: number;
  /** True when this entry represents a single file, not a directory */
  isFile?: boolean;
  /** File-level fields (only set when isFile=true) */
  language?: string;
  hasDoc?: boolean;
  isEntryPoint?: boolean;
  isTest?: boolean;
  dominantCommunityId?: number | undefined;
  /** Health rollups from the module API (0 / false / null when absent). */
  hotspotCount?: number;
  deadCount?: number;
  hasDecision?: boolean;
  primaryOwner?: string | null;
  [key: string]: unknown;
}

// ---- Helpers ----

/** Extract directory path from a file node_id (everything before the last /). */
function dirOf(nodeId: string): string {
  const idx = nodeId.lastIndexOf("/");
  return idx > 0 ? nodeId.slice(0, idx) : "";
}

/** Build all ancestor directories for grouping (e.g. "src/auth/middleware" → ["src", "src/auth", "src/auth/middleware"]). */
function ancestorDirs(dir: string): string[] {
  if (!dir) return [];
  const parts = dir.split("/");
  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    result.push(parts.slice(0, i + 1).join("/"));
  }
  return result;
}

/** Deduplicate edges: group by (source, target) pair, merge imported_names, sum count. */
function deduplicateEdges(
  edges: GraphEdgeResponse[],
): { source: string; target: string; importedNames: string[]; edgeCount: number; confidence: number | undefined }[] {
  const map = new Map<
    string,
    { source: string; target: string; importedNames: string[]; edgeCount: number; confidence: number | undefined }
  >();
  for (const e of edges) {
    const key = `${e.source}→${e.target}`;
    const existing = map.get(key);
    if (existing) {
      existing.importedNames.push(...e.imported_names);
      existing.edgeCount++;
      if (e.confidence != null) {
        existing.confidence = Math.max(existing.confidence ?? 0, e.confidence);
      }
    } else {
      map.set(key, {
        source: e.source,
        target: e.target,
        importedNames: [...e.imported_names],
        edgeCount: 1,
        confidence: e.confidence,
      });
    }
  }
  return Array.from(map.values());
}

// ---- Pure position computation (for Sigma bridge) ----

interface ElkPositionResult {
  positions: Map<string, { x: number; y: number; width: number; height: number }>;
  groups: Map<string, { x: number; y: number; width: number; height: number }>;
}

function flattenPositions(
  elkNode: ElkNode,
  offsetX = 0,
  offsetY = 0,
  positions: Map<string, { x: number; y: number; width: number; height: number }>,
  groups: Map<string, { x: number; y: number; width: number; height: number }>,
) {
  if (!elkNode.children) return;
  for (const child of elkNode.children) {
    const x = (child.x ?? 0) + offsetX;
    const y = (child.y ?? 0) + offsetY;
    const w = child.width ?? 0;
    const h = child.height ?? 0;
    if (child.id.startsWith("dir:")) {
      groups.set(child.id, { x, y, width: w, height: h });
      flattenPositions(child, x, y, positions, groups);
    } else {
      positions.set(child.id, { x, y, width: w, height: h });
    }
  }
}

export async function computeElkFilePositions(
  nodes: GraphNodeResponse[],
  edges: GraphEdgeResponse[],
): Promise<ElkPositionResult> {
  if (nodes.length === 0) return { positions: new Map(), groups: new Map() };

  const nodeSet = new Set(nodes.map((n) => n.node_id));
  const validEdges = edges.filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target));
  const dedupedEdges = deduplicateEdges(validEdges);

  const dirSet = new Set<string>();
  for (const n of nodes) {
    const dir = dirOf(n.node_id);
    if (dir) {
      for (const ancestor of ancestorDirs(dir)) {
        dirSet.add(ancestor);
      }
    }
  }

  const dirs = Array.from(dirSet).sort();

  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.layered.spacing.edgeNodeBetweenLayers": "35",
      "elk.spacing.nodeNode": "40",
      "elk.spacing.componentComponent": "60",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.padding": "[top=45,left=15,bottom=15,right=15]",
    },
    children: [],
    edges: [],
  };

  const dirElkNodes = new Map<string, ElkNode>();
  for (const dir of dirs) {
    const parts = dir.split("/");
    const label = parts[parts.length - 1] ?? dir;
    const elkNode: ElkNode = {
      id: `dir:${dir}`,
      labels: [{ text: label }],
      layoutOptions: {
        "elk.padding": "[top=40,left=12,bottom=12,right=12]",
      },
      children: [],
    };
    dirElkNodes.set(dir, elkNode);
  }

  for (const dir of dirs) {
    const parentDir = dirOf(dir);
    const parentElk = parentDir ? dirElkNodes.get(parentDir) : null;
    const elkNode = dirElkNodes.get(dir)!;
    if (parentElk) {
      parentElk.children!.push(elkNode);
    } else {
      elkGraph.children!.push(elkNode);
    }
  }

  for (const n of nodes) {
    const scale = 1 + Math.min(0.6, n.pagerank * 25);
    const elkFileNode: ElkNode = {
      id: n.node_id,
      width: Math.round(FILE_NODE_WIDTH * scale),
      height: Math.round(FILE_NODE_HEIGHT * scale),
      labels: [{ text: n.node_id.split("/").pop() ?? n.node_id }],
    };
    const dir = dirOf(n.node_id);
    const parentElk = dir ? dirElkNodes.get(dir) : null;
    if (parentElk) {
      parentElk.children!.push(elkFileNode);
    } else {
      elkGraph.children!.push(elkFileNode);
    }
  }

  const elkEdges: ElkExtendedEdge[] = dedupedEdges.map((e, i) => ({
    id: `e${i}`,
    sources: [e.source],
    targets: [e.target],
  }));
  elkGraph.edges = elkEdges;

  const layout = await elk.layout(elkGraph);

  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  const groups = new Map<string, { x: number; y: number; width: number; height: number }>();
  flattenPositions(layout, 0, 0, positions, groups);

  return { positions, groups };
}

