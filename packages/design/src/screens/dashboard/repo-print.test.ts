import { describe, expect, it } from "vitest";
import { printCells } from "./repo-print";

describe("printCells", () => {
  it("is the same for the same repository and counts", () => {
    expect(printCells("acme/widgets", 30, 10)).toEqual(printCells("acme/widgets", 30, 10));
  });

  it("differs between repositories", () => {
    const a = printCells("acme/widgets", 30, 10).map((cell) => [cell.x, cell.y, cell.width, cell.height]);
    const b = printCells("acme/gadgets", 30, 10).map((cell) => [cell.x, cell.y, cell.width, cell.height]);
    expect(a).not.toEqual(b);
  });

  it("keeps the recorded split: as many kept cells as the share, rounded, and never hides a kind that exists", () => {
    const cells = printCells("acme/widgets", 1, 1);
    const kept = cells.filter((cell) => cell.kept).length;
    expect(kept).toBe(Math.round(cells.length / 2));
    expect(cells.length).toBeGreaterThanOrEqual(5);
    expect(cells.length).toBeLessThanOrEqual(9);

    expect(printCells("acme/widgets", 1, 999).filter((cell) => cell.kept)).toHaveLength(1);
    expect(printCells("acme/widgets", 999, 1).filter((cell) => !cell.kept)).toHaveLength(1);
    expect(printCells("acme/widgets", 5, 0).every((cell) => cell.kept)).toBe(true);
    expect(printCells("acme/widgets", 0, 5).some((cell) => cell.kept)).toBe(false);
  });
});
