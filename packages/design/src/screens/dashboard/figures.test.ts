import { TIER_MAX_FILES } from "@repohive/indexer";
import { describe, expect, it } from "vitest";
import type { ViewBodies } from "../../contracts";
import { SIZE_MAX_FILES, figuresFromAdaptivity, keptPercent, sizeClassForFiles } from "./figures";

const entry = { files: 2985, regions: 502, assessed: 286, preserved: 38, reconstructed: 248, degenerate: 216, preserveShare: 38 / 286 };
const view = (repos: unknown[]): ViewBodies["adaptivity"] => ({ repos }) as unknown as ViewBodies["adaptivity"];

describe("figuresFromAdaptivity", () => {
  it("reads the one repository entry as the engine recorded it", () => {
    expect(figuresFromAdaptivity(view([entry]))).toEqual(entry);
  });

  it("keeps a missing share as null, and refuses an entry with a missing count", () => {
    expect(figuresFromAdaptivity(view([{ ...entry, assessed: 0, preserveShare: null }]))?.preserveShare).toBeNull();
    expect(figuresFromAdaptivity(view([{ ...entry, files: undefined }]))).toBeUndefined();
    expect(figuresFromAdaptivity(view([{ ...entry, regions: "502" }]))).toBeUndefined();
    expect(figuresFromAdaptivity(view([]))).toBeUndefined();
    expect(figuresFromAdaptivity({} as ViewBodies["adaptivity"])).toBeUndefined();
  });

  it("rounds the share for display only", () => {
    const figures = figuresFromAdaptivity(view([entry]));
    expect(figures && keptPercent(figures)).toBe(13);
    expect(figures?.preserveShare).toBe(38 / 286);
  });
});

describe("size classes", () => {
  it("use the caps the indexer admits a repository under", () => {
    expect(SIZE_MAX_FILES).toEqual(TIER_MAX_FILES);
  });

  it("name the smallest class a file count fits", () => {
    expect([0, 1000, 1001, 5000, 5001, 15000, 15001, 30000, 99999].map(sizeClassForFiles)).toEqual([
      "S",
      "S",
      "M",
      "M",
      "L",
      "L",
      "XL",
      "XL",
      "XL",
    ]);
  });
});
