import { describe, it, expect } from "vitest";
import {
  boundarySegment,
  deriveRegionViews,
  effectiveActionAt,
  independenceOf,
  recomputeScore,
  squashCohesion,
  tallyViews,
} from "../../src/repohive/decision-model.js";
import type { RegionPoint } from "../../src/repohive/types.js";

// The rule set mirrored here is the engine's own (core assessor):
//   score = (wc · c/(c+k) + wp · (1 − clamp01(p))) / (wc + wp)
// The fixture values below are recorded jsoup outputs, so a drift between
// this model and the engine formula fails against real data, not synthetic.

function region(partial: Partial<RegionPoint> & { regionId: string }): RegionPoint {
  return {
    label: partial.regionId,
    cohesion: 0,
    coupling: 1,
    score: 0,
    decisionConfidence: 0.5,
    action: "reconstruct",
    automaticAction: "reconstruct",
    userOverridden: false,
    fileCount: 1,
    groupIds: [],
    ...partial,
  };
}

describe("recomputeScore", () => {
  it("reproduces the engine's recorded score for a real preserved region", () => {
    // jsoup pkg:org.jsoup.parser, exactly as recorded in its metadata.json.
    const score = recomputeScore(22.36842105263158, 0.5175936435868331, 1, {
      cohesion: 0.4,
      coupling: 0.4,
    });
    expect(score).not.toBeNull();
    expect(score!).toBeCloseTo(0.719806781810187, 12);
  });

  it("reproduces a real reconstructed region", () => {
    // jsoup pkg:org.jsoup.helper, exactly as recorded in its metadata.json.
    const score = recomputeScore(3.6, 0.8269230769230769, 1, { cohesion: 0.4, coupling: 0.4 });
    expect(score!).toBeCloseTo(0.47784280936454854, 12);
  });

  it("declines to recompute when a modularity weight was applied", () => {
    expect(recomputeScore(1, 0.5, 1, { cohesion: 0.4, coupling: 0.4, modularity: 0.2 })).toBeNull();
  });

  it("declines on degenerate weights instead of dividing by zero", () => {
    expect(recomputeScore(1, 0.5, 1, { cohesion: 0, coupling: 0 })).toBeNull();
  });
});

describe("squash and independence", () => {
  it("squash is bounded and monotonic", () => {
    expect(squashCohesion(0, 1)).toBe(0);
    expect(squashCohesion(1, 1)).toBe(0.5);
    expect(squashCohesion(1e9, 1)).toBeLessThan(1);
    expect(squashCohesion(3, 1)).toBeGreaterThan(squashCohesion(2, 1));
  });

  it("independence clamps coupling into [0,1] first", () => {
    expect(independenceOf(0)).toBe(1);
    expect(independenceOf(1)).toBe(0);
    expect(independenceOf(2)).toBe(0); // clamped, never negative
  });
});

describe("effectiveActionAt", () => {
  it("applies score >= boundary, inclusive at equality", () => {
    const r = region({ regionId: "pkg:a", score: 0.5 });
    expect(effectiveActionAt(r, 0.5)).toBe("preserve");
    expect(effectiveActionAt(r, 0.500001)).toBe("reconstruct");
  });

  it("pins user-overridden regions at every boundary", () => {
    const r = region({
      regionId: "pkg:a",
      score: 0.9,
      action: "reconstruct",
      automaticAction: "preserve",
      userOverridden: true,
    });
    expect(effectiveActionAt(r, 0)).toBe("reconstruct");
    expect(effectiveActionAt(r, 1)).toBe("reconstruct");
  });
});

describe("deriveRegionViews", () => {
  const regions = [
    region({ regionId: "pkg:b", score: 0.7, action: "preserve", automaticAction: "preserve" }),
    region({ regionId: "pkg:a", score: 0.2 }),
  ];

  it("keeps canonical regionId order regardless of input order", () => {
    const views = deriveRegionViews(regions, 1, 0.5);
    expect(views.map((v) => v.regionId)).toEqual(["pkg:a", "pkg:b"]);
  });

  it("is a pure function: same input, identical output", () => {
    const a = deriveRegionViews(regions, 1, 0.31);
    const b = deriveRegionViews(regions, 1, 0.31);
    expect(a).toEqual(b);
  });

  it("flags flips only where the counterfactual boundary crosses a score", () => {
    const views = deriveRegionViews(regions, 1, 0.1); // below both scores
    expect(views.find((v) => v.regionId === "pkg:a")!.flipped).toBe(true); // 0.2 >= 0.1 now preserves
    expect(views.find((v) => v.regionId === "pkg:b")!.flipped).toBe(false);
    expect(tallyViews(views)).toEqual({ preserve: 2, reconstruct: 0, flipped: 1 });
  });
});

describe("boundarySegment", () => {
  it("is the anti-diagonal x + y = 2B for equal weights", () => {
    const seg = boundarySegment(0.5, { cohesion: 0.4, coupling: 0.4 })!;
    // Both endpoints satisfy x + y = 1.
    expect(seg.x1 + seg.y1).toBeCloseTo(1, 9);
    expect(seg.x2 + seg.y2).toBeCloseTo(1, 9);
    expect(seg.x1).not.toBeCloseTo(seg.x2, 9);
  });

  it("returns null when the line misses the unit square or weights are unusable", () => {
    expect(boundarySegment(2, { cohesion: 0.4, coupling: 0.4 })).toBeNull(); // x+y=4
    expect(boundarySegment(0.5, { cohesion: 0.4, coupling: 0.4, modularity: 0.2 })).toBeNull();
    expect(boundarySegment(0.5, { cohesion: 0, coupling: 0 })).toBeNull();
  });
});
