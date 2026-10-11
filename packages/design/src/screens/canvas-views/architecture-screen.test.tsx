import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithDesign } from "../../test-utils";
import { ArchitectureScreen } from "./architecture-screen";
import { blockLook, blockOf, cellAt, cellSize } from "./dsm";
import { ARCHITECTURE } from "./test-fixtures";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
});
afterEach(() => vi.restoreAllMocks());

describe("ArchitectureScreen", () => {
  it("heads the matrix with recorded counts only", () => {
    renderWithDesign(<ArchitectureScreen data={ARCHITECTURE} />);
    expect(screen.getByText("Level 2 · 3 of 5 groups · 3 of 7 edges")).toBeInTheDocument();
    expect(screen.getByText("1 rebuilt; the largest became 3 groups")).toBeInTheDocument();
  });

  it("draws one cell per recorded entry and one outline per region, dashed for rebuilt", () => {
    const { container } = renderWithDesign(<ArchitectureScreen data={ARCHITECTURE} />);
    expect(container.querySelectorAll("rect.rh-dsm-cell")).toHaveLength(3);
    const blocks = [...container.querySelectorAll("rect.rh-dsm-blk")];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).not.toHaveClass("rh-r");
    expect(blocks[1]).toHaveClass("rh-r");
  });

  it("lists the regions on the diagonal and locks one on click", () => {
    const { container } = renderWithDesign(<ArchitectureScreen data={ARCHITECTURE} />);
    const list = screen.getByRole("list");
    const buttons = within(list).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("b · 1 groups · rebuilt from dependencies")).toBeInTheDocument();
    expect(container.querySelector("rect.rh-dsm-blk.rh-on")).not.toBeNull();
    fireEvent.click(buttons[1]!);
    expect(buttons[1]).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelector("rect.rh-dsm-blk.rh-on")).toBeNull();
  });

  it("reads a cell with the cursor keys: who depends on whom, and the weight", () => {
    const { container } = renderWithDesign(<ArchitectureScreen data={ARCHITECTURE} />);
    const svg = container.querySelector(".rh-dsm-wrap svg")!;
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(screen.getByText("alpha (a) → alpha (a) · no dependency")).toBeInTheDocument();
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(screen.getByText("alpha (a) → beta (a) · weight 3")).toBeInTheDocument();
    fireEvent.keyDown(svg, { key: "ArrowDown" });
    expect(screen.getByText("beta (a) → beta (a) · no dependency")).toBeInTheDocument();
    expect(container.querySelectorAll("rect.rh-dsm-cross")).toHaveLength(2);
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(container.querySelectorAll("rect.rh-dsm-cross")).toHaveLength(0);
  });

  it("ranks groups by incoming weight and selects one from its row", () => {
    renderWithDesign(<ArchitectureScreen data={ARCHITECTURE} />);
    const table = screen.getByRole("table", { name: "Most depended-on groups" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]!.textContent)).toEqual(["alpha", "beta", "gamma"]);
    fireEvent.click(rows[0]!);
    expect(screen.getByText("alpha · used by weight 9, uses weight 3")).toBeInTheDocument();
  });

  it("lists each level with its recorded counts, and a dash where nothing crosses", () => {
    renderWithDesign(<ArchitectureScreen data={ARCHITECTURE} />);
    const rows = within(screen.getByRole("table", { name: "Levels" })).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["1 Level 1", "104", "-", ""]);
    expect(within(rows[1]!).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["2 Level 2", "106", "40", ""]);
  });

  it("shows how far each package was split and the determinism evidence, without a digest it was not given", () => {
    const { container } = renderWithDesign(<ArchitectureScreen data={ARCHITECTURE} />);
    expect(container.querySelectorAll(".rh-frag-segs i")).toHaveLength(3);
    expect(screen.getByText("3 groups")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("r_0123456789abcdef0123…")).toBeInTheDocument();
    expect(screen.getByText("g_fedcba9876543210fedc… · 12 members")).toBeInTheDocument();
    expect(screen.queryByText("Group digest")).toBeNull();
  });

  it("says so when no group or region was recorded", () => {
    const empty = {
      ...ARCHITECTURE,
      dsm: { ...ARCHITECTURE.dsm, groups: [], entries: [], blocks: [] },
      fragmentation: { ...ARCHITECTURE.fragmentation, regions: [], totalReconstructed: 0, maxSplit: 0 },
    };
    renderWithDesign(<ArchitectureScreen data={empty} />);
    expect(screen.getByText("No groups at this level")).toBeInTheDocument();
    expect(screen.getByText("No package was split")).toBeInTheDocument();
  });
});

describe("matrix geometry", () => {
  it("keeps cells between 8 and 16 units", () => {
    expect(cellSize(1000, 10)).toBe(16);
    expect(cellSize(600, 48)).toBe(12);
    expect(cellSize(100, 48)).toBe(8);
  });

  it("finds the block that holds a group", () => {
    expect(blockOf(ARCHITECTURE.dsm.blocks, 1)?.regionId).toBe("pkg:a");
    expect(blockOf(ARCHITECTURE.dsm.blocks, 2)?.regionId).toBe("pkg:b");
    expect(blockOf(ARCHITECTURE.dsm.blocks, 3)).toBeUndefined();
  });

  it("maps a point to a cell, and nothing outside the matrix", () => {
    const box = { left: 10, top: 20, width: 100 };
    // 3 groups of 12 units: the viewBox is 38 wide, so 100px is a scale of 0.38 units per pixel.
    expect(cellAt(10 + 50, 20 + 50, box, 12, 3)).toEqual({ x: 1, y: 1 });
    expect(cellAt(5, 5, box, 12, 3)).toBeUndefined();
    expect(cellAt(500, 500, box, 12, 3)).toBeUndefined();
  });

  it("words a block by its look: a region with no decision is not drawn as kept or rebuilt", () => {
    expect(blockLook("preserve")).toBe("kept");
    expect(blockLook("reconstruct")).toBe("rebuilt");
    expect(blockLook("degenerate")).toBe("unassessed");
    expect(blockLook("none")).toBe("unassessed");
  });
});
