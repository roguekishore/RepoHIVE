import { describe, expect, it } from "vitest";
import { fallbackTextSizes, fitText, readTextSizes, snapSize } from "./text";

const measure = { measureText: (text: string) => ({ width: text.length * 10 }) as TextMetrics };

describe("canvas text", () => {
  it("fits text with an ellipsis, or not at all", () => {
    expect(fitText(measure, "hello", 100)).toBe("hello");
    expect(fitText(measure, "hello world", 60)).toBe("hello…".slice(0, 5) + "…");
    expect(fitText(measure, "hello", 5)).toBe("");
    expect(fitText(measure, "hello", 0)).toBe("");
  });

  it("snaps a size down to the nearest step", () => {
    expect(snapSize(13, [12, 14, 16])).toBe(12);
    expect(snapSize(14, [12, 14, 16])).toBe(14);
    expect(snapSize(99, [12, 14, 16])).toBe(16);
    expect(snapSize(5, [12, 14, 16])).toBe(12);
  });

  it("reads each role from the page, falling back where the page cannot say", () => {
    const sizes = readTextSizes(document.documentElement);
    expect(Object.keys(sizes).sort()).toEqual(Object.keys(fallbackTextSizes()).sort());
    for (const px of Object.values(sizes)) expect(px).toBeGreaterThan(0);
    expect(document.documentElement.querySelector("span[aria-hidden]")).toBeNull();
  });
});
