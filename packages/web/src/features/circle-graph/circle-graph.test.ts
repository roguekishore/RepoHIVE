import { describe, expect, it } from "vitest";
import type { BlastRadiusData } from "@repohive/views";
import type { ZoomMap, ZoomNode } from "@/features/structure-map/canvas";
import { MARGIN, PAD, childRadii, forceLayout } from "./graph-layout";
import { buildCircleModel, circlePath, linksOf } from "./model";

describe("forceLayout", () => {
  it.each([2, 3, 7, 20, 60])("keeps %i circles inside the parent without overlap", (n) => {
    const radii = childRadii(Array.from({ length: n }, (_, i) => 1 + ((i * 37) % 200)));
    const links = Array.from({ length: n - 1 }, (_, i) => ({ a: i, b: (i * 5 + 3) % n, weight: 1 + i }));
    const pos = forceLayout(radii, links);
    for (let i = 0; i < n; i++) {
      expect(Math.hypot(pos[i]!.x, pos[i]!.y) + radii[i]!).toBeLessThanOrEqual(1 - MARGIN + 1e-6);
      for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(pos[i]!.x - pos[j]!.x, pos[i]!.y - pos[j]!.y);
        expect(d).toBeGreaterThanOrEqual(radii[i]! + radii[j]! + PAD * 0.5);
      }
    }
  });

  it("is deterministic and pulls related circles closer than unrelated ones", () => {
    // One big circle and many small ones, so the small ones have room to move.
    const radii = childRadii([400, ...Array.from({ length: 16 }, () => 4)]);
    const links = [{ a: 3, b: 16, weight: 50 }];
    const first = forceLayout(radii, links);
    expect(forceLayout(radii, links)).toEqual(first);
    const without = forceLayout(radii, []);
    const d = (p: typeof first, i: number, j: number) => Math.hypot(p[i]!.x - p[j]!.x, p[i]!.y - p[j]!.y);
    expect(d(first, 3, 16)).toBeLessThan(d(without, 3, 16));
    expect(d(first, 3, 16)).toBeLessThan(radii[3]! + radii[16]! + PAD * 3);
  });
});

function node(id: string, parent: string | null, children: string[], kind: ZoomNode["kind"] = "folder"): ZoomNode {
  return {
    id,
    parent_id: parent,
    level: 0,
    kind,
    name: id,
    path: id,
    children,
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
  };
}

// root -> {A, B}; A -> a1 (single child, collapses) -> {f1, f2}; B -> {f3, f4}
const MAP: ZoomMap = {
  root_id: "root",
  project_name: "t",
  total_files: 4,
  max_depth: 3,
  truncated: false,
  nodes: [
    node("root", null, ["A", "B"], "system"),
    node("A", "root", ["a1"]),
    node("a1", "A", ["f1", "f2"]),
    node("B", "root", ["f3", "f4"]),
    node("f1", "a1", [], "file"),
    node("f2", "a1", [], "file"),
    node("f3", "B", [], "file"),
    node("f4", "B", [], "file"),
  ],
  relations: [{ parent_id: "root", source_id: "A", target_id: "B", label: "uses", edge_count: 3, coupling: "tight" }],
};

const IDS = ["root", "A", "a1", "f1", "f2", "B", "f3", "f4", "f1#fn"];
const PARENT: Record<string, string> = { A: "root", a1: "A", f1: "a1", f2: "a1", B: "root", f3: "B", f4: "B", "f1#fn": "f1" };
const POS = new Map(IDS.map((id, i) => [id, i]));
const BLAST: BlastRadiusData = {
  ids: IDS,
  kinds: IDS.map(() => "file"),
  parents: IDS.map((id) => (PARENT[id] ? POS.get(PARENT[id]!)! : -1)),
  children: IDS.map(() => []),
  // A function in f1 depends on f3, f1 on f2, and f4 on f1.
  edges: [
    [POS.get("f1#fn")!, POS.get("f3")!],
    [POS.get("f1")!, POS.get("f2")!],
    [POS.get("f4")!, POS.get("f1")!],
  ],
};

describe("buildCircleModel", () => {
  it("collapses single-child runs", () => {
    const m = buildCircleModel(MAP);
    expect(m.circleOf.get("A")).toBe("a1");
    expect(m.nodes.get("a1")!.label).toBe("A / a1");
    expect(m.nodes.has("A")).toBe(false);
    expect(circlePath(m, "f1").map((n) => n.id)).toEqual(["root", "a1", "f1"]);
  });

  it("nests every circle inside its parent", () => {
    const m = buildCircleModel(MAP);
    for (const n of m.nodes.values()) {
      if (!n.parentId) continue;
      const p = m.nodes.get(n.parentId)!;
      expect(Math.hypot(n.x - p.x, n.y - p.y) + n.r).toBeLessThanOrEqual(p.r + 1e-9);
    }
  });

  it("falls back to sibling relations without leaf edges", () => {
    const m = buildCircleModel(MAP);
    expect(m.leafLinks).toBe(false);
    expect(linksOf(m, "a1").out).toEqual(new Map([["B", 3]]));
  });

  it("answers a selection's links from leaf edges, excluding links inside it", () => {
    const m = buildCircleModel(MAP, BLAST);
    expect(m.leafLinks).toBe(true);
    const group = linksOf(m, "a1");
    expect(group.out).toEqual(new Map([["f3", 1]]));
    expect(group.in).toEqual(new Map([["f4", 1]]));
    const file = linksOf(m, "f1");
    expect(file.out).toEqual(new Map([["f2", 1], ["f3", 1]]));
    expect(file.in).toEqual(new Map([["f4", 1]]));
  });
});
