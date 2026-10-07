import { describe, expect, it } from "vitest";
import { formatBoundary, formatCount, formatDate, formatScore, formatShare, shortId } from "./format";
import { REGIONS, region } from "./fixtures";
import { assessedRegions, closestToBoundary, decisionOf, isCloseCall, isUnassessed, largestRegions, scoreBins, tallyAssessed, tallyByModule } from "./regions";

describe("what the engine recorded for a region", () => {
  it("calls a region unassessed when it scored 0 by rule", () => {
    const tiny = REGIONS.find((r) => r.regionId === "pkg:app.tiny");
    expect(tiny && isUnassessed(tiny)).toBe(true);
    expect(tiny && decisionOf(tiny)).toBe("unassessed");
  });

  it("takes kept and rebuilt from the recorded action, not from the score", () => {
    // A recorded override: the score is under the boundary but the action is preserve.
    const overridden = region({ regionId: "pkg:x", score: 0.3, cohesion: 0.5, coupling: 0.5, action: "preserve", userOverridden: true });
    expect(decisionOf(overridden)).toBe("kept");
    expect(decisionOf(region({ regionId: "pkg:y", score: 0.9, cohesion: 3, coupling: 0.1, action: "reconstruct" }))).toBe("rebuilt");
  });

  it("drops unassessed regions from the assessed list", () => {
    expect(assessedRegions(REGIONS)).toHaveLength(5);
  });
});

describe("orderings", () => {
  it("lists the largest regions by files, the name breaking ties", () => {
    const tied = [region({ regionId: "pkg:b", score: 0.4, cohesion: 1, coupling: 0.5, action: "reconstruct" }), region({ regionId: "pkg:a", score: 0.4, cohesion: 1, coupling: 0.5, action: "reconstruct" })];
    expect(largestRegions(REGIONS, 2).map((r) => r.displayName)).toEqual(["app.core", "app.web"]);
    expect(largestRegions(tied, 2).map((r) => r.displayName)).toEqual(["a", "b"]);
  });

  it("lists close calls nearest the recorded boundary first", () => {
    expect(closestToBoundary(assessedRegions(REGIONS), 0.5, 3).map((r) => r.displayName)).toEqual(["app.data", "app.web", "app.core"]);
    // The same regions at another recorded boundary come out in another order.
    expect(closestToBoundary(assessedRegions(REGIONS), 0.2, 1).map((r) => r.displayName)).toEqual(["app.util"]);
  });

  it("is the same on every call", () => {
    const first = closestToBoundary(REGIONS, 0.5, 6).map((r) => r.regionId);
    const second = closestToBoundary([...REGIONS].reverse(), 0.5, 6).map((r) => r.regionId);
    expect(second).toEqual(first);
  });

  it("marks a close call within 0.05 of the boundary", () => {
    expect(isCloseCall(region({ regionId: "pkg:c", score: 0.52, cohesion: 1, coupling: 1, action: "preserve" }), 0.5)).toBe(true);
    expect(isCloseCall(region({ regionId: "pkg:d", score: 0.56, cohesion: 1, coupling: 1, action: "preserve" }), 0.5)).toBe(false);
  });
});

describe("tallies of recorded values", () => {
  it("counts assessed regions by action", () => {
    expect(tallyAssessed(REGIONS)).toEqual({ kept: 3, rebuilt: 2 });
  });

  it("bins scores in twentieths, a score of 1 in the last bin, and splits by action", () => {
    const bins = scoreBins(REGIONS);
    expect(bins).toHaveLength(20);
    expect(bins[4]).toMatchObject({ kept: 0, rebuilt: 1 }); // 0.20
    expect(bins[9]).toMatchObject({ kept: 0, rebuilt: 1 }); // 0.48
    expect(bins[10]).toMatchObject({ kept: 1, rebuilt: 0 }); // 0.51
    expect(bins[12]).toMatchObject({ kept: 1, rebuilt: 0 }); // 0.62
    expect(bins[19]).toMatchObject({ kept: 1, rebuilt: 0 }); // 1.00
    expect(bins.reduce((sum, bin) => sum + bin.kept + bin.rebuilt, 0)).toBe(5); // the unassessed region is not binned
  });
});

describe("how recorded numbers are written", () => {
  it("is fixed to one locale", () => {
    expect(formatCount(30889)).toBe("30,889");
    expect(formatScore(0.5)).toBe("0.500");
    expect(formatShare(0.13286713286713286)).toBe("13.3%");
    expect(formatShare(null)).toBe("—");
    expect(formatBoundary(0.5)).toBe("0.50");
    expect(formatBoundary(0.375)).toBe("0.375");
    expect(shortId("2f866c4d558414aa1c8c5d794c8b9164")).toBe("2f866c4d");
  });

  it("writes a date in UTC", () => {
    expect(formatDate("2026-10-01T23:59:59.000Z")).toBe("1 Oct 2026");
    expect(formatDate("not a date")).toBe("not a date");
  });
});

describe("tallyByModule", () => {
  it("tallies recorded actions of assessed regions by the first segment after the prefix", () => {
    const tally = tallyByModule(REGIONS, "app.", 6);
    expect(tally.find((module) => module.name === "core")).toEqual({ name: "core", kept: 1, rebuilt: 0 });
    expect(tally.some((module) => module.name === "tiny")).toBe(false);
  });

  it("orders the largest module first and honours the limit", () => {
    expect(tallyByModule(REGIONS, "", 1)).toEqual([{ name: "app", kept: 3, rebuilt: 2 }]);
  });
});
