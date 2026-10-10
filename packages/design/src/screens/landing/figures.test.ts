import { describe, expect, it } from "vitest";
import { BROADLEAF_FIGURES as F } from "./broadleaf-figures";

/** The committed figures must hang together the way the script checked them when it wrote them. */
describe("the committed Broadleaf figures", () => {
  it("add up", () => {
    const c = F.counts;
    expect(c.assessed).toBe(c.preserved + c.reconstructed);
    expect(c.regions).toBe(c.assessed + c.degenerate);
    expect(c.edges).toBe(c.leafEdges + c.crossGroupEdges);
    expect(F.regions).toHaveLength(c.assessed);
    expect(F.regions.filter((r) => r[5] === 1)).toHaveLength(c.preserved);
    expect(F.regions.filter((r) => r[5] === 2)).toHaveLength(c.reconstructed);
    expect(c.preserveShare).toBeCloseTo(c.preserved / c.assessed, 5);
  });

  it("record every decision at the boundary the scores were measured against", () => {
    for (const [name, , , , score, decision] of F.regions) {
      expect(decision, name).toBe(score >= F.settings.boundary ? 1 : 2);
    }
  });

  it("name the parser signal level, and the signals present are the ones with edges", () => {
    expect(F.signal.level.length).toBeGreaterThan(0);
    const present = [F.signal.imports > 0, F.signal.calls > 0, F.signal.sharedTypes > 0].filter(Boolean).length;
    expect(present).toBeGreaterThan(0);
    expect(F.signal.imports).toBeLessThanOrEqual(F.counts.leafEdges);
  });

  it("follow regions that exist, with the decision the story needs", () => {
    const byName = new Map(F.regions.map((r) => [r[0], r]));
    for (const name of F.featured.kept) expect(byName.get(name)?.[5], name).toBe(1);
    expect(byName.get(F.featured.rebuilt)?.[5]).toBe(2);
    expect(F.zoom.groups).toHaveLength(4);
  });

  it("describe a sunburst whose first ring covers the circle", () => {
    const ring1 = F.arcs.filter((a) => a[0] === 1);
    expect(ring1.reduce((sum, a) => sum + a[2], 0)).toBeCloseTo(1, 3);
    for (const [, start, span] of F.arcs) {
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start + span).toBeLessThanOrEqual(1 + 1e-4);
    }
  });

  it("describe a map that lists a parent before its children", () => {
    F.map.forEach((row, i) => {
      if (i === 0) expect(row[0]).toBe(-1);
      else expect(row[0]).toBeLessThan(i);
    });
    expect(F.map[0]?.[1]).toBe(F.counts.files);
  });

  it("describe a matrix whose cells and blocks sit inside it", () => {
    for (const [from, to, weight] of F.dsm.entries) {
      expect(from).toBeLessThan(F.dsm.n);
      expect(to).toBeLessThan(F.dsm.n);
      expect(weight).toBeLessThanOrEqual(F.dsm.max);
    }
    for (const [start, size] of F.dsm.blocks) expect(start + size).toBeLessThanOrEqual(F.dsm.n);
  });

  it("place every file and link inside the thumbnail's square", () => {
    expect(F.flat.points).toHaveLength(F.counts.files);
    for (const [x, y] of F.flat.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1000);
    }
    for (const index of F.flat.links) expect(index).toBeLessThan(F.counts.files);
  });

  it("carry a digest over the five index files in contract order", () => {
    expect(F.determinism.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(F.determinism.files.map((f) => f.name)).toEqual(["repository.json", "hierarchy.json", "nodes.json", "edges.json", "metadata.json"]);
    for (const f of F.determinism.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(F.determinism.sampleGroupId).toMatch(/^g_[0-9a-f]{40}$/);
  });
});
