import { describe, it, expect } from "vitest";
import {
  assessedPreserveShare,
  boundarySegment,
  deriveRegionViews,
  effectiveActionAt,
  independenceOf,
  isDegenerate,
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
    expect(tallyViews(views)).toEqual({
      preserve: 2,
      reconstruct: 0,
      degenerate: 0,
      flipped: 1,
      assessed: 2,
    });
  });
});

describe("isDegenerate — the rule-assigned signature", () => {
  it("recognises score 0 with cohesion 0", () => {
    // jsoup pkg:org.jsoup.examples, exactly as recorded: 4 files, no internal
    // edges, so the assessor short-circuited to degenerateScore.
    expect(isDegenerate({ score: 0, cohesion: 0 })).toBe(true);
  });

  it("does not claim a measured region with a real score", () => {
    expect(isDegenerate({ score: 0.19674355495251017, cohesion: 0.5714285714285714 })).toBe(false);
    expect(isDegenerate({ score: 0.2, cohesion: 0 })).toBe(false); // scored, just cohesion-free
    expect(isDegenerate({ score: 0, cohesion: 1.5 })).toBe(false); // measured to exactly 0
  });
});

describe("three-way state and the flip set", () => {
  const mixed = [
    // Degenerate: the recorded jsoup examples region.
    region({ regionId: "pkg:deg", score: 0, cohesion: 0, coupling: 1 }),
    // Measured and reconstructed, 0.022 under the boundary (jsoup helper).
    region({
      regionId: "pkg:marginal",
      score: 0.47784280936454854,
      cohesion: 3.6,
      coupling: 0.8269230769230769,
    }),
    // Measured and preserved (jsoup parser).
    region({
      regionId: "pkg:kept",
      score: 0.719806781810187,
      cohesion: 22.36842105263158,
      coupling: 0.5175936435868331,
      action: "preserve",
      automaticAction: "preserve",
    }),
  ];

  it("reports degenerate as its own state, never as an action", () => {
    const views = deriveRegionViews(mixed, 1, 0.5);
    const byId = new Map(views.map((v) => [v.regionId, v]));
    expect(byId.get("pkg:deg")!.state).toBe("degenerate");
    expect(byId.get("pkg:deg")!.recordedState).toBe("degenerate");
    expect(byId.get("pkg:marginal")!.state).toBe("reconstruct");
    expect(byId.get("pkg:kept")!.state).toBe("preserve");
  });

  it("counts three ways and never folds degenerate into reconstruct", () => {
    expect(tallyViews(deriveRegionViews(mixed, 1, 0.5))).toEqual({
      preserve: 1,
      reconstruct: 1,
      degenerate: 1,
      flipped: 0,
      assessed: 2,
    });
  });

  it("excludes degenerate regions from the flip set at every boundary", () => {
    for (const boundary of [0, 0.25, 0.5, 0.75, 1]) {
      const views = deriveRegionViews(mixed, 1, boundary);
      const deg = views.find((v) => v.regionId === "pkg:deg")!;
      expect(deg.flipped).toBe(false);
      expect(deg.effectiveAction).toBe("reconstruct"); // pinned to its recorded action
    }
  });

  it("flips the marginal region just above its recorded score, and only it", () => {
    // 0.4778… sits 0.0222 under the recorded 0.5: lowering the boundary past
    // it preserves that region and nothing else moves.
    const views = deriveRegionViews(mixed, 1, 0.45);
    expect(views.filter((v) => v.flipped).map((v) => v.regionId)).toEqual(["pkg:marginal"]);
    expect(tallyViews(views)).toEqual({
      preserve: 2,
      reconstruct: 0,
      degenerate: 1,
      flipped: 1,
      assessed: 2,
    });
  });

  it("reports the assessed-only preserve share, excluding rule-assigned regions", () => {
    // 1 of 2 assessed, NOT 1 of 3 — the whole point of the statistic.
    expect(assessedPreserveShare(deriveRegionViews(mixed, 1, 0.5))).toBeCloseTo(0.5, 12);
  });

  it("returns null rather than 0 when nothing was assessed", () => {
    const allDegenerate = deriveRegionViews(
      [region({ regionId: "pkg:x" }), region({ regionId: "pkg:y" })],
      1,
      0.5,
    );
    expect(allDegenerate.every((v) => v.degenerate)).toBe(true);
    expect(assessedPreserveShare(allDegenerate)).toBeNull();
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
