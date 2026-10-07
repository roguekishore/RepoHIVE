import { describe, expect, it } from "vitest";
import { zoomMap } from "./fixtures";
import { buildMapModel, findCard, linksOf } from "./model";

describe("buildMapModel", () => {
  it("reads every card from the recorded map, depth first from the root", () => {
    const model = buildMapModel(zoomMap());
    expect(model.nodes.map((node) => node.name)).toEqual(["widgets", "core", "Account.java", "Order.java", "web", "Page.java"]);
    expect(model.nodes[1]).toMatchObject({ decision: "kept", files: 4, parent: 0 });
    expect(model.nodes[4]).toMatchObject({ decision: "rebuilt" });
    expect(model.nodes[2]?.decision).toBeNull();
    expect(model.totalFiles).toBe(6);
  });

  it("gives the same layout for the same input, however often it is built", () => {
    const first = buildMapModel(zoomMap());
    const second = buildMapModel(zoomMap());
    expect(second.rects).toEqual(first.rects);
  });

  it("keeps every child inside its parent and gives the larger card the larger area", () => {
    const model = buildMapModel(zoomMap());
    const [, core, , , web] = model.rects;
    expect(core!.w * core!.h).toBeGreaterThan(web!.w * web!.h);
    for (const node of model.nodes) {
      const parent = model.rects[node.parent];
      const rect = model.rects[node.i]!;
      if (parent === undefined) continue;
      expect(rect.x).toBeGreaterThanOrEqual(parent.x);
      expect(rect.y).toBeGreaterThanOrEqual(parent.y);
      expect(rect.x + rect.w).toBeLessThanOrEqual(parent.x + parent.w + 1e-9);
      expect(rect.y + rect.h).toBeLessThanOrEqual(parent.y + parent.h + 1e-9);
    }
  });

  it("is empty, not broken, for a map with no cards", () => {
    const model = buildMapModel({ ...zoomMap(), nodes: [] });
    expect(model.nodes).toEqual([]);
  });
});

describe("linksOf and findCard", () => {
  it("lists a card's recorded relations to its siblings, with the recorded count", () => {
    const model = buildMapModel(zoomMap());
    expect(linksOf(model, 4).uses).toEqual([{ other: 1, direction: "uses", count: 7 }]);
    expect(linksOf(model, 1).usedBy).toEqual([{ other: 4, direction: "used by", count: 7 }]);
    expect(linksOf(model, 2)).toEqual({ uses: [], usedBy: [] });
  });

  it("finds the closest name, prefix first", () => {
    const model = buildMapModel(zoomMap());
    expect(findCard(model, "ord")).toBe(3);
    expect(findCard(model, "java")).toBe(5); // no name starts with it: the shortest name wins
    expect(findCard(model, "acc")).toBe(2);
    expect(findCard(model, "zzz")).toBe(-1);
    expect(findCard(model, "  ")).toBe(-1);
  });
});
