import { describe, expect, it } from "vitest";
import { HitIndex } from "./hit";

describe("HitIndex", () => {
  it("finds the shape under a point and nothing elsewhere", () => {
    const hits = new HitIndex<string>();
    hits.addRect(10, 10, 100, 50, "card");
    hits.addCircle(300, 300, 20, "dot");
    expect(hits.at(50, 30)).toBe("card");
    expect(hits.at(300, 315)).toBe("dot");
    expect(hits.at(200, 200)).toBeUndefined();
    expect(hits.at(325, 300)).toBeUndefined();
  });

  it("prefers the deepest shape, then the one drawn last", () => {
    const hits = new HitIndex<string>();
    hits.addRect(0, 0, 100, 100, "parent", 0);
    hits.addRect(10, 10, 20, 20, "child", 1);
    hits.addRect(10, 10, 20, 20, "sibling", 1);
    expect(hits.at(15, 15)).toBe("sibling");
    expect(hits.at(80, 80)).toBe("parent");
  });

  it("grows targets by the slop and clears", () => {
    const hits = new HitIndex<string>();
    hits.addCircle(10, 10, 2, "tiny");
    expect(hits.at(16, 10)).toBeUndefined();
    expect(hits.at(16, 10, 5)).toBe("tiny");
    hits.clear();
    expect(hits.size).toBe(0);
    expect(hits.at(10, 10)).toBeUndefined();
  });
});
