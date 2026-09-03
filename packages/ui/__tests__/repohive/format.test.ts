import { describe, it, expect } from "vitest";
import {
  displayNumber,
  displayPercent,
  elidePackage,
  middleElide,
} from "../../src/repohive/format.js";

describe("displayNumber", () => {
  it("rounds for display and trims trailing zeros", () => {
    expect(displayNumber(0.47784280936454854)).toBe("0.478");
    expect(displayNumber(0.5)).toBe("0.5");
    expect(displayNumber(1)).toBe("1");
    expect(displayNumber(0)).toBe("0");
  });

  it("never widens a value it cannot represent", () => {
    // Rounding is display-only; the caller keeps the exact value for the title.
    expect(displayNumber(0.0221571906354514)).toBe("0.022");
    expect(displayNumber(0.0004)).toBe("0");
  });

  it("passes non-finite values through rather than inventing digits", () => {
    expect(displayNumber(Number.NaN)).toBe("NaN");
    expect(displayNumber(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});

describe("displayPercent", () => {
  it("renders a share as whole percent", () => {
    expect(displayPercent(38 / 286)).toBe("13%"); // broadleaf, assessed only
    expect(displayPercent(10 / 17)).toBe("59%"); // vantage, assessed only
    expect(displayPercent(1)).toBe("100%");
  });

  it("renders an absent share as an em dash, never as 0%", () => {
    expect(displayPercent(null)).toBe("—");
  });
});

describe("middleElide", () => {
  it("keeps both ends, because the tail carries the distinguishing characters", () => {
    const id = "g_002c619ae75eab55f7c1a8e2d3b4c5f6a7b8c9d0";
    const out = middleElide(id, 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out).toContain("…");
    expect(out.startsWith("g_")).toBe(true);
    expect(id.endsWith(out.slice(out.indexOf("…") + 1))).toBe(true);
  });

  it("leaves short values untouched", () => {
    expect(middleElide("org.jsoup", 28)).toBe("org.jsoup");
    expect(middleElide("g_abc", 28)).toBe("g_abc");
  });

  it("is deterministic", () => {
    const id = "pkg:com.broadleafcommerce.core.catalog.domain";
    expect(middleElide(id, 24)).toBe(middleElide(id, 24));
  });
});

describe("elidePackage", () => {
  it("drops shared leading segments and keeps the naming tail", () => {
    expect(elidePackage("com.broadleafcommerce.core.catalog.domain", 3)).toBe(
      "…core.catalog.domain",
    );
  });

  it("leaves a path with few segments alone", () => {
    expect(elidePackage("org.jsoup.helper", 3)).toBe("org.jsoup.helper");
    expect(elidePackage("org.jsoup", 3)).toBe("org.jsoup");
  });
});
