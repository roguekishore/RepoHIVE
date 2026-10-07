import type { ZoomMap, ZoomNode } from "@repohive/views";

/** A small recorded map for the tests of this folder: one repository, two groups, three files, two relations. */
function node(partial: Partial<ZoomNode> & Pick<ZoomNode, "id" | "parent_id" | "level" | "kind" | "name">): ZoomNode {
  return {
    path: partial.name,
    children: [],
    importance: 1,
    sibling_rank: 0,
    metrics: { file_count: 1, descendant_count: 0, hotspot_count: 0, dead_count: 0, entry_point_count: 0, on_flow_count: 0 },
    layout: null,
    summary: "",
    language: null,
    health_score: null,
    is_entry_point: false,
    is_hotspot: false,
    is_dead: false,
    is_test: false,
    on_flow: false,
    ...partial,
  };
}

const files = (count: number): ZoomNode["metrics"] => ({ file_count: count, descendant_count: 0, hotspot_count: 0, dead_count: 0, entry_point_count: 0, on_flow_count: 0 });

export function zoomMap(): ZoomMap {
  return {
    root_id: "root",
    project_name: "widgets",
    total_files: 6,
    max_depth: 2,
    truncated: false,
    nodes: [
      node({ id: "root", parent_id: null, level: 0, kind: "system", name: "widgets", children: ["g_core", "g_web"], metrics: files(6) }),
      node({ id: "g_core", parent_id: "root", level: 1, kind: "group", name: "core", children: ["f_a", "f_b"], metrics: files(4), importance: 4, sibling_rank: 0, decision: "preserve", summary: "preserve, quality 0.62" }),
      node({ id: "g_web", parent_id: "root", level: 1, kind: "group", name: "web", children: ["f_c"], metrics: files(2), importance: 2, sibling_rank: 1, decision: "reconstruct" }),
      node({ id: "f_a", parent_id: "g_core", level: 2, kind: "file", name: "Account.java", path: "core/Account.java" }),
      node({ id: "f_b", parent_id: "g_core", level: 2, kind: "file", name: "Order.java", path: "core/Order.java" }),
      node({ id: "f_c", parent_id: "g_web", level: 2, kind: "file", name: "Page.java", path: "web/Page.java" }),
    ],
    relations: [{ parent_id: "root", source_id: "g_web", target_id: "g_core", label: "", edge_count: 7, coupling: "tight" }],
  };
}
