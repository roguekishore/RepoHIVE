import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithDesign } from "../../test-utils";
import { arcName, HierarchyScreen } from "./hierarchy-screen";
import { HIERARCHY } from "./test-fixtures";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
});
afterEach(() => vi.restoreAllMocks());

const arcs = (container: HTMLElement): Element[] => [...container.querySelectorAll("path[data-a]")];

describe("HierarchyScreen", () => {
  it("draws one path per recorded arc and the recorded file total at the hub", () => {
    const { container } = renderWithDesign(<HierarchyScreen owner="o" name="r" data={HIERARCHY} />);
    expect(arcs(container)).toHaveLength(HIERARCHY.arcs.length);
    expect(container.querySelector(".rh-sun-count")).toHaveTextContent("100");
  });

  it("says what it shows, and how many small arcs were left out, from recorded numbers", () => {
    renderWithDesign(<HierarchyScreen owner="o" name="r" data={HIERARCHY} />);
    expect(screen.getByText(/Radius is depth, sweep is files/)).toHaveTextContent("100 files in 6 arcs");
    expect(screen.getByText("3 small arcs omitted")).toBeInTheDocument();
  });

  it("tells kept from rebuilt by texture as well as colour", () => {
    const { container } = renderWithDesign(<HierarchyScreen owner="o" name="r" data={HIERARCHY} />);
    expect(container.querySelectorAll(".rh-arc-rebuilt")).toHaveLength(2);
    expect(container.querySelector("pattern#rh-sun-hatch")).not.toBeNull();
  });

  it("shows the arc under the pointer in the status line", () => {
    const { container } = renderWithDesign(<HierarchyScreen owner="o" name="r" data={HIERARCHY} />);
    fireEvent.mouseOver(arcs(container)[1]!);
    expect(screen.getByText("Level 1 · web · 25 files · rebuilt")).toBeInTheDocument();
    fireEvent.mouseLeave(container.querySelector("svg.rh-sun")!);
    expect(screen.getByText(/Radius is depth/)).toBeInTheDocument();
  });

  it("selects on click, shows the inspector with recorded values only, and clears", () => {
    const { container } = renderWithDesign(<HierarchyScreen owner="o" name="r" data={HIERARCHY} />);
    fireEvent.click(arcs(container)[1]!);
    const panel = screen.getByRole("complementary", { name: "Selection" });
    expect(within(panel).getByRole("heading", { name: "web" })).toBeInTheDocument();
    expect(within(panel).getByText("Level 1")).toBeInTheDocument();
    expect(within(panel).getByText("Rebuilt")).toBeInTheDocument();
    expect(within(panel).getByText("25")).toBeInTheDocument();
    // No share or percentage: the arc's file count over the total is a derived figure, not a recorded one.
    expect(panel.textContent).not.toMatch(/%/);
    expect(within(panel).getByRole("link", { name: "Show in Decisions" })).toHaveAttribute(
      "href",
      "/repos/o/r/decision-audit?region=pkg%3Acom.example.web",
    );
    fireEvent.click(within(panel).getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("clicking the selected arc again clears it; a wrapper has no decision and no link", () => {
    const { container } = renderWithDesign(<HierarchyScreen owner="o" name="r" data={HIERARCHY} />);
    fireEvent.click(arcs(container)[3]!);
    const panel = screen.getByRole("complementary", { name: "Selection" });
    expect(within(panel).getByRole("heading", { name: "Wrapper group" })).toBeInTheDocument();
    expect(within(panel).queryByRole("link")).toBeNull();
    expect(within(panel).queryByText(/Kept|Rebuilt|Unassessed/)).toBeNull();
    fireEvent.click(arcs(container)[3]!);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("moves between arcs with the arrow keys and clears on Escape", () => {
    const { container } = renderWithDesign(<HierarchyScreen owner="o" name="r" data={HIERARCHY} />);
    const svg = container.querySelector("svg.rh-sun")!;
    const heading = (): string | null => screen.queryByRole("heading", { level: 4 })?.textContent ?? null;
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(heading()).toBe("core");
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(heading()).toBe("web");
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    fireEvent.keyDown(svg, { key: "ArrowDown" });
    expect(heading()).toBe("Group");
    fireEvent.keyDown(svg, { key: "ArrowUp" });
    expect(heading()).toBe("core");
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(heading()).toBeNull();
  });

  it("draws nothing until the stage has a size", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(0);
    const { container } = renderWithDesign(<HierarchyScreen owner="o" name="r" data={HIERARCHY} />);
    expect(container.querySelector("svg.rh-sun")).toBeNull();
  });
});

describe("arcName", () => {
  it("prefers the label, then a file path, then the kind of group", () => {
    expect(arcName(HIERARCHY.arcs[0]!)).toBe("core");
    expect(arcName(HIERARCHY.arcs[5]!)).toBe("src/B.java");
    expect(arcName(HIERARCHY.arcs[3]!)).toBe("Wrapper group");
    expect(arcName(HIERARCHY.arcs[2]!)).toBe("Group");
  });
});
