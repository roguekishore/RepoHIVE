// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BROADLEAF_FIGURES as F } from "../landing/broadleaf-figures";
import { branchOf, buildHiveModel, buildStrata, clamp, number, pieceHeight, readoutFor, ringLabels, sm } from "./model";

const M = buildHiveModel(F);
const S = buildStrata(F);

describe("the cells", () => {
  it("has one cell per file, and the committed index has 2,985 files", () => {
    expect(M.n).toBe(F.counts.files);
    expect(M.n).toBe(2985);
    expect(M.flat).toHaveLength(M.n * 2);
    expect(M.hive).toHaveLength(M.n * 2);
  });

  it("gives every cell its own place in the honeycomb", () => {
    const seen = new Set<string>();
    for (let i = 0; i < M.n; i++) seen.add(`${M.hive[i * 2]!.toFixed(5)},${M.hive[i * 2 + 1]!.toFixed(5)}`);
    expect(seen.size).toBe(M.n);
  });

  it("has finite numbers everywhere", () => {
    for (const array of [M.flat, M.hive, M.delay, M.phase, M.jit, M.tint, M.frac]) {
      expect(array.every(Number.isFinite)).toBe(true);
    }
    expect(Number.isFinite(M.hexS)).toBe(true);
  });

  it("deals files to leaves so each kind matches the recorded decisions", () => {
    const kinds = { 0: 0, 1: 0, 2: 0, 3: 0 } as Record<number, number>;
    M.kindOf.forEach((k) => (kinds[k] = (kinds[k] ?? 0) + 1));
    expect(kinds[0]).toBe(0);
    expect(kinds[1]! + kinds[2]! + kinds[3]!).toBe(M.n);
  });

  it("is the same on every build (seeded, no clock)", () => {
    const a = buildHiveModel({ ...F });
    expect(Array.from(a.delay.slice(0, 20))).toEqual(Array.from(M.delay.slice(0, 20)));
    expect(Array.from(a.hive.slice(0, 40))).toEqual(Array.from(M.hive.slice(0, 40)));
  });

  it("places each file's sweep position strictly inside 0 to 1, in order", () => {
    expect(M.frac[0]).toBeGreaterThan(0);
    expect(M.frac[M.n - 1]).toBeLessThan(1);
    for (let i = 1; i < M.n; i++) expect(M.frac[i]!).toBeGreaterThan(M.frac[i - 1]!);
  });

  it("counts the regions the third plate shows", () => {
    expect(M.leaves).toBeGreaterThan(F.counts.assessed);
  });
});

describe("the strata", () => {
  it("counts the pieces per level as the index recorded them", () => {
    expect(S.perRing).toEqual({ 1: 2, 2: 26, 3: 292, 4: 344 });
    expect(S.total).toBe(F.arcs.length);
  });

  it("nests every piece below level 1 in a piece one level up that holds at least as many files", () => {
    S.arcs.forEach((arc, k) => {
      const parent = S.parentOf[k]!;
      if (arc[0] === 1) {
        expect(parent).toBe(-1);
        return;
      }
      expect(parent, `arc ${k} on level ${arc[0]}`).toBeGreaterThanOrEqual(0);
      expect(S.arcs[parent]![0]).toBe(arc[0] - 1);
      expect(S.arcs[parent]![3]).toBeGreaterThanOrEqual(arc[3]);
    });
  });

  it("finds the arc that covers a position, and none outside the ring", () => {
    expect(S.arcAt(1, 0.0001)).toBeGreaterThanOrEqual(0);
    expect(S.arcAt(1, 1.5)).toBe(-1);
  });

  it("does not draw slivers too thin to see, but still counts them", () => {
    expect(S.drawn.filter(Boolean).length).toBeLessThan(S.total);
    expect(S.drawn.every((d, k) => !d || F.arcs[k]![2] >= 0.0012)).toBe(true);
  });

  it("stands kept pieces tallest and too-small pieces lowest", () => {
    expect(pieceHeight(1)).toBeGreaterThan(pieceHeight(2));
    expect(pieceHeight(2)).toBeGreaterThan(pieceHeight(3));
  });

  it("labels the stack the way the approved design does", () => {
    const labels = ringLabels(F, S).map((l) => `${l.before}${l.count}${l.after}`);
    expect(labels).toEqual(["Repository · 2,985 files", "Level 1 · 2 groups", "Level 2 · 26 groups", "Level 3 · 292 pieces", "Level 4 · 344 pieces"]);
  });
});

describe("the explorer's readout", () => {
  it("describes the repository when nothing is picked", () => {
    const r = readoutFor(F, S, -1, false, 0);
    expect(r).toMatchObject({ level: "Repository", files: "2,985", share: "100% of the repository", below: "2 groups on level 1" });
    expect(r.tag).toBe(F.repository);
  });

  it("describes a piece by its level, files, share, parent and children", () => {
    const k = S.arcs.findIndex((a, i) => a[0] === 2 && S.childCount[i]! > 0);
    const r = readoutFor(F, S, k, true, 7);
    const arc = S.arcs[k]!;
    expect(r.level).toBe("Level 2 · selected");
    expect(r.files).toBe(number.format(arc[3]));
    expect(r.inside).toMatch(/^A level-1 piece of [\d,]+ files$/);
    expect(r.below).toMatch(/^\d+ pieces? on level 3$/);
    expect(r.hint).toContain("7 pieces lit");
  });

  it("says that level 4 has files below it that are not drawn", () => {
    const k = S.arcs.findIndex((a) => a[0] === 4);
    expect(readoutFor(F, S, k, false, 0).below).toBe("Files and their functions, not drawn here");
  });

  it("follows a branch up to the repository and down to the files", () => {
    const k = S.arcs.findIndex((a, i) => a[0] === 2 && S.childCount[i]! > 0);
    const set = branchOf(S, k);
    expect(set.has(k)).toBe(true);
    expect(set.has(S.parentOf[k]!)).toBe(true);
    const child = S.parentOf.findIndex((p) => p === k);
    expect(set.has(child)).toBe(true);
    // a piece on the same level that is not on the branch stays dark
    const other = S.arcs.findIndex((a, i) => a[0] === 2 && i !== k);
    expect(set.has(other)).toBe(false);
  });
});

describe("helpers", () => {
  it("clamps and eases", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(sm(0)).toBe(0);
    expect(sm(1)).toBe(1);
    expect(sm(0.5)).toBe(0.5);
  });
});
