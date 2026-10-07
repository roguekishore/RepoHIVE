import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithDesign } from "../test-utils";
import { matchScore, rankMatches } from "./match";
import { SearchPalette, type PaletteGroup } from "./search-palette";

describe("matchScore and rankMatches", () => {
  it("scores a prefix above a substring and a short name above a long one", () => {
    expect(matchScore("Overview", "over")).toBe(8);
    expect(matchScore("Map overview", "over")).toBe(112);
    expect(matchScore("Map", "xyz")).toBe(-1);
    expect(matchScore("Hierarchy", "hi")).toBeLessThan(matchScore("Architecture", "hi"));
  });

  it("ranks, drops non-matches and respects the limit", () => {
    const names = ["Hierarchy", "Decisions", "Architecture", "Adaptivity", "Overview"];
    expect(rankMatches(names, (n) => n, "ar", 5)).toEqual(["Architecture", "Hierarchy"]);
    expect(rankMatches(names, (n) => n, "i", 2)).toHaveLength(2);
  });

  it("returns the first items for an empty query, in order", () => {
    expect(rankMatches(["a", "b", "c"], (n) => n, "  ", 2)).toEqual(["a", "b"]);
  });

  it("keeps input order between equal scores", () => {
    expect(rankMatches(["bbb", "aaa", "ccc"], (n) => n, "b", 3)).toEqual(["bbb"]);
    expect(rankMatches(["xa", "ya", "za"], (n) => n, "a", 3)).toEqual(["xa", "ya", "za"]);
  });
});

const VIEWS = [
  { id: "overview", label: "Overview", icon: "overview", href: "/repos/o/r/overview" },
  { id: "map", label: "Map", icon: "map", href: "/repos/o/r/knowledge-graph" },
  { id: "hier", label: "Hierarchy", icon: "hierarchy", href: "/repos/o/r/hierarchy" },
] as const;

const FILES = [{ id: "f1", label: "OrderService.java", meta: "core.order", icon: "file" as const, onSelect: () => undefined }];

const groups = (query: string): readonly PaletteGroup[] => [
  { label: "Views", items: rankMatches(VIEWS, (view) => view.label, query, 5) },
  { label: "Files", items: query === "" ? [] : rankMatches(FILES, (file) => file.label, query, 5) },
];

describe("SearchPalette", () => {
  it("renders nothing while closed", () => {
    renderWithDesign(<SearchPalette open={false} onClose={() => undefined} groups={groups} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens with the search box focused and the initial groups listed", () => {
    renderWithDesign(<SearchPalette open onClose={() => undefined} groups={groups} placeholder="Search views" />);
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Overview", "Map", "Hierarchy"]);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("moves with the arrow keys, stays inside the list, and points the combobox at the active option", async () => {
    renderWithDesign(<SearchPalette open onClose={() => undefined} groups={groups} />);
    const box = screen.getByRole("combobox");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    const options = screen.getAllByRole("option");
    expect(options[2]).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", options[2]?.id);
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("filters as you type and shows an empty message when nothing matches", async () => {
    renderWithDesign(<SearchPalette open onClose={() => undefined} groups={(q) => (q === "zzz" ? [] : groups(q))} />);
    await userEvent.type(screen.getByRole("combobox"), "hier");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Hierarchy"]);
    await userEvent.clear(screen.getByRole("combobox"));
    await userEvent.type(screen.getByRole("combobox"), "zzz");
    expect(screen.getByText('Nothing matches "zzz".')).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("Enter closes and navigates through the host for an item with a path", async () => {
    const onClose = vi.fn();
    const navigate = vi.fn();
    renderWithDesign(<SearchPalette open onClose={onClose} groups={groups} />, { navigate });
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/repos/o/r/knowledge-graph");
  });

  it("runs an item's own action instead of navigating", async () => {
    const onSelect = vi.fn();
    const navigate = vi.fn();
    renderWithDesign(
      <SearchPalette
        open
        onClose={() => undefined}
        groups={() => [{ label: "Actions", items: [{ id: "a", label: "Index a repository", icon: "plus", href: "/ignored", onSelect }] }]}
      />,
      { navigate },
    );
    await userEvent.click(screen.getByRole("option", { name: /Index a repository/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("hovering moves the selection", async () => {
    renderWithDesign(<SearchPalette open onClose={() => undefined} groups={groups} />);
    await userEvent.hover(screen.getByRole("option", { name: "Hierarchy" }));
    expect(screen.getByRole("option", { name: "Hierarchy" })).toHaveAttribute("aria-selected", "true");
  });

  it("Escape and a click on the scrim close it", async () => {
    const onClose = vi.fn();
    const { container } = renderWithDesign(<SearchPalette open onClose={onClose} groups={groups} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(container.querySelector(".rh-scrim") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows group labels and the secondary text", async () => {
    renderWithDesign(<SearchPalette open onClose={() => undefined} groups={groups} footnote="Files are from this repository" />);
    await userEvent.type(screen.getByRole("combobox"), "o");
    expect(screen.getByRole("group", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByText("core.order")).toBeInTheDocument();
    expect(screen.getByText("Files are from this repository")).toBeInTheDocument();
  });

  it("resets the query each time it opens", async () => {
    const { rerender } = renderWithDesign(<SearchPalette open onClose={() => undefined} groups={groups} />);
    await userEvent.type(screen.getByRole("combobox"), "map");
    rerender(<SearchPalette open={false} onClose={() => undefined} groups={groups} />);
    rerender(<SearchPalette open onClose={() => undefined} groups={groups} />);
    expect(screen.getByRole("combobox")).toHaveValue("");
  });
});
