import { describe, expect, it } from "vitest";
import { arcPath, buildArcTree, sunLayout, sunState } from "./sunburst";
import { HIERARCHY } from "./test-fixtures";

describe("sunLayout", () => {
  it("centres on the stage and leaves a margin", () => {
    const layout = sunLayout(800, 600, 4);
    expect(layout.cx).toBe(400);
    expect(layout.cy).toBe(300);
    expect(layout.hub + layout.ring * 4).toBeCloseTo(300 - 16, 6);
  });

  it("never divides by zero for a flat tree", () => {
    expect(Number.isFinite(sunLayout(100, 100, 0).ring)).toBe(true);
  });
});

describe("arcPath", () => {
  const layout = sunLayout(400, 400, 2);

  it("is deterministic and closed", () => {
    const path = arcPath(layout, 1, 0.25, 0.25);
    expect(path).toBe(arcPath(layout, 1, 0.25, 0.25));
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
  });

  it("starts at twelve o-clock and runs clockwise", () => {
    const [, x, y] = /^M(\S+) (\S+) A/.exec(arcPath(layout, 1, 0, 0.25)) ?? [];
    expect(Number(x)).toBeCloseTo(layout.cx, 1);
    expect(Number(y)).toBeLessThan(layout.cy);
  });

  it("marks a sweep beyond half a turn as a large arc and stops a full turn short of closing", () => {
    expect(arcPath(layout, 1, 0, 0.75)).toContain("0 1 1");
    expect(arcPath(layout, 1, 0, 1)).toMatch(/A\S+ \S+ 0 1 1/);
  });
});

describe("sunState", () => {
  it("separates a wrapper, kept, rebuilt and unassessed", () => {
    expect(HIERARCHY.arcs.map(sunState)).toEqual(["kept", "rebuilt", "unassessed", "wrapper", "kept", "rebuilt"]);
  });
});

describe("buildArcTree", () => {
  const tree = buildArcTree(HIERARCHY.arcs);

  it("finds each parent by sweep", () => {
    expect(tree.parent).toEqual([-1, -1, -1, -1, 0, 0]);
  });

  it("finds the first child and the ring neighbours", () => {
    expect(tree.firstChild[0]).toBe(4);
    expect(tree.firstChild[1]).toBe(-1);
    expect(tree.next[0]).toBe(1);
    expect(tree.previous[1]).toBe(0);
    expect(tree.next[3]).toBe(-1);
    expect(tree.next[4]).toBe(5);
    expect(tree.roots).toEqual([0, 1, 2, 3]);
  });
});
