import Graph from "graphology";

/** The fields of `views/graph.json` this view reads. */
export interface FlatNode {
  node_id: string;
  symbol_count: number;
  community_id: number;
}

export interface FlatLink {
  source: string;
  target: string;
}

export interface FlatGraphData {
  nodes: FlatNode[];
  links: FlatLink[];
}

export interface FlatNodeAttributes {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  path: string;
  module: string;
  symbols: number;
  community: number;
}

export interface FlatEdgeAttributes {
  size: number;
  color: string;
  type: "arrow" | "line";
}

export type FlatGraph = Graph<FlatNodeAttributes, FlatEdgeAttributes>;

export interface ModuleCount {
  id: string;
  fileCount: number;
}

const ROOT_MODULE = "(repo root)";
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Above this many edges, arrowheads cost more than they tell. */
const ARROW_EDGE_LIMIT = 6000;

/**
 * The module a file belongs to: the directory above `src/` in a Maven or
 * Gradle layout, and otherwise the first two directories of its path.
 */
export function moduleOf(path: string): string {
  const parts = path.split("/");
  const srcAt = parts.indexOf("src");
  if (srcAt > 0) return parts.slice(0, srcAt).join("/");
  if (srcAt === 0) {
    // `src/main/java/org/acme/...`: no module directory, so use the package.
    const javaAt = parts.indexOf("java");
    const pkg = javaAt >= 0 ? parts.slice(javaAt + 1, -1) : parts.slice(1, -1);
    return pkg.length > 0 ? pkg.slice(0, 2).join("/") : ROOT_MODULE;
  }
  if (parts.length === 1) return ROOT_MODULE;
  return parts.slice(0, Math.min(2, parts.length - 1)).join("/");
}

function nodeSize(symbols: number, order: number): number {
  const scale = order > 5000 ? 0.5 : order > 2000 ? 0.7 : 1;
  return Math.max(1.5, (3 + Math.log2(1 + symbols)) * scale);
}

/**
 * The graph with every file seeded on a disc around its group's centre, so the
 * layout starts from the grouping and the same data always starts the same way.
 * Colours are left empty: they depend on the theme and are set by the canvas.
 */
export function buildFlatGraph(data: FlatGraphData): FlatGraph {
  const graph: FlatGraph = new Graph({ type: "directed", multi: false });
  const order = data.nodes.length;

  const groups = new Map<number, FlatNode[]>();
  for (const node of data.nodes) {
    const members = groups.get(node.community_id);
    if (members) members.push(node);
    else groups.set(node.community_id, [node]);
  }

  let groupIndex = 0;
  for (const communityId of [...groups.keys()].sort((a, b) => a - b)) {
    const radius = 90 * Math.sqrt(groupIndex + 0.5);
    const cx = radius * Math.cos(groupIndex * GOLDEN_ANGLE);
    const cy = radius * Math.sin(groupIndex * GOLDEN_ANGLE);
    groups.get(communityId)!.forEach((node, k) => {
      const r = 7 * Math.sqrt(k + 0.5);
      graph.addNode(node.node_id, {
        x: cx + r * Math.cos(k * GOLDEN_ANGLE),
        y: cy + r * Math.sin(k * GOLDEN_ANGLE),
        size: nodeSize(node.symbol_count, order),
        color: "",
        label: node.node_id.slice(node.node_id.lastIndexOf("/") + 1),
        path: node.node_id,
        module: moduleOf(node.node_id),
        symbols: node.symbol_count,
        community: communityId,
      });
    });
    groupIndex++;
  }

  const type = data.links.length > ARROW_EDGE_LIMIT ? "line" : "arrow";
  for (const link of data.links) {
    if (link.source === link.target || !graph.hasNode(link.source) || !graph.hasNode(link.target)) continue;
    if (graph.hasDirectedEdge(link.source, link.target)) continue;
    graph.addDirectedEdge(link.source, link.target, { size: 0.6, color: "", type });
  }
  return graph;
}

/** Modules with their file counts, largest first. */
export function moduleCounts(graph: FlatGraph): ModuleCount[] {
  const counts = new Map<string, number>();
  graph.forEachNode((_id, attrs) => counts.set(attrs.module, (counts.get(attrs.module) ?? 0) + 1));
  return [...counts]
    .map(([id, fileCount]) => ({ id, fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount || a.id.localeCompare(b.id));
}

/** Files whose path contains `query` (case-insensitive); `null` for a blank query. */
export function matchingNodes(graph: FlatGraph, query: string): Set<string> | null {
  const needle = query.trim().toLowerCase();
  if (needle === "") return null;
  const matches = new Set<string>();
  graph.forEachNode((id, attrs) => {
    if (attrs.path.toLowerCase().includes(needle)) matches.add(id);
  });
  return matches;
}

/** Files outside `module`, or `null` when no module is chosen. */
export function nodesOutsideModule(graph: FlatGraph, module: string | null): Set<string> | null {
  if (module === null) return null;
  const outside = new Set<string>();
  graph.forEachNode((id, attrs) => {
    if (attrs.module !== module) outside.add(id);
  });
  return outside;
}
