import { describe, expect, it } from "vitest";
import { createRng, hashSeed } from "./seeded";

describe("seeded randomness", () => {
  it("hashes the same parts to the same number, and different parts to different numbers", () => {
    expect(hashSeed("a", "b")).toBe(hashSeed("a", "b"));
    expect(hashSeed("a", "b")).not.toBe(hashSeed("b", "a"));
    expect(hashSeed("ab", "c")).not.toBe(hashSeed("a", "bc"));
    expect(hashSeed(1, 2)).toBe(hashSeed("1", "2"));
  });

  it("gives the same sequence for the same seed", () => {
    const run = (next: () => number): number[] => Array.from({ length: 8 }, next);
    expect(run(createRng("seed"))).toEqual(run(createRng("seed")));
    expect(run(createRng(1))).not.toEqual(run(createRng(2)));
  });

  it("stays in [0, 1)", () => {
    const next = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
