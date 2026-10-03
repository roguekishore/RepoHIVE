import { describe, expect, it } from "vitest";
import { buildFlatGraph, matchingNodes, moduleCounts, moduleOf, nodesOutsideModule } from "./graph-model";

const A = "core/src/main/java/org/acme/A.java";
const B = "core/src/main/java/org/acme/B.java";
const C = "web/src/main/java/org/acme/C.java";

const DATA = {
  nodes: [
    { node_id: A, symbol_count: 3, community_id: 0 },
    { node_id: B, symbol_count: 0, community_id: 0 },
    { node_id: C, symbol_count: 7, community_id: 1 },
  ],
  links: [
    { source: A, target: B },
    { source: A, target: B },
    { source: C, target: C },
    { source: C, target: "missing.java" },
    { source: C, target: A },
  ],
};

describe("moduleOf", () => {
  it("uses the directory above src/ when there is one", () => {
    expect(moduleOf("core/broadleaf-framework/src/main/java/x/Y.java")).toBe("core/broadleaf-framework");
  });

  it("falls back to the package when src/ is at the root", () => {
    expect(moduleOf("src/main/java/org/acme/util/Z.java")).toBe("org/acme");
  });

  it("uses the first two directories without a src/ segment", () => {
    expect(moduleOf("a/b/c/D.java")).toBe("a/b");
    expect(moduleOf("a/D.java")).toBe("a");
    expect(moduleOf("D.java")).toBe("(repo root)");
  });
});

describe("buildFlatGraph", () => {
  it("keeps one edge per ordered pair and drops self-loops and dangling links", () => {
    const graph = buildFlatGraph(DATA);
    expect(graph.order).toBe(3);
    expect(graph.size).toBe(2);
  });

  it("is deterministic: the same data seeds the same positions", () => {
    const a = buildFlatGraph(DATA);
    const b = buildFlatGraph(DATA);
    a.forEachNode((id, attrs) => {
      expect(b.getNodeAttribute(id, "x")).toBe(attrs.x);
      expect(b.getNodeAttribute(id, "y")).toBe(attrs.y);
    });
  });

  it("labels a file by its name and sizes it by symbol count", () => {
    const graph = buildFlatGraph(DATA);
    expect(graph.getNodeAttribute(C, "label")).toBe("C.java");
    expect(graph.getNodeAttribute(C, "size")).toBeGreaterThan(graph.getNodeAttribute(B, "size"));
  });
});

describe("filters", () => {
  const graph = buildFlatGraph(DATA);

  it("counts files per module, largest first", () => {
    expect(moduleCounts(graph)).toEqual([
      { id: "core", fileCount: 2 },
      { id: "web", fileCount: 1 },
    ]);
  });

  it("matches a path substring case-insensitively, and nothing for a blank query", () => {
    expect(matchingNodes(graph, "  ")).toBeNull();
    expect([...matchingNodes(graph, "c.JAVA")!]).toEqual([C]);
  });

  it("lists the files outside the chosen module", () => {
    expect(nodesOutsideModule(graph, null)).toBeNull();
    expect([...nodesOutsideModule(graph, "web")!].sort()).toEqual([A, B]);
  });
});
