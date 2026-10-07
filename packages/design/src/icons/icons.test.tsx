import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ICON_NAMES, Icon } from "./icons";
import { Brand, Mark, Wordmark } from "./mark";

describe("icons", () => {
  it("has the set the screens use", () => {
    for (const name of [
      "search", "list", "activity", "book", "overview", "map", "hierarchy", "decide", "layers", "graph", "compare",
      "circles", "user", "plus", "minus", "fit", "x", "menu", "file", "region", "repo", "refresh", "arrow",
    ]) {
      expect(ICON_NAMES, name).toContain(name);
    }
  });

  it("draws every icon as a 16-grid svg with something in it, hidden from assistive technology", () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector("svg");
      expect(svg, name).toHaveAttribute("viewBox", "0 0 16 16");
      expect(svg, name).toHaveAttribute("aria-hidden", "true");
      expect(svg?.children.length, name).toBeGreaterThan(0);
      unmount();
    }
  });

  it("uses only currentColor, so an icon follows the text colour", () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      for (const node of container.querySelectorAll("[stroke], [fill]")) {
        for (const attribute of ["stroke", "fill"]) {
          const value = node.getAttribute(attribute);
          if (value !== null) expect(["currentColor", "none"], `${name} ${attribute}`).toContain(value);
        }
      }
      unmount();
    }
  });

  it("takes a size and can carry a label", () => {
    const { container } = render(<Icon name="search" size={24} label="Search" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "24");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "Search");
    expect(svg).not.toHaveAttribute("aria-hidden");
  });
});

describe("the mark", () => {
  it("is three solid cells and one cell broken into four", () => {
    const { container } = render(<Mark />);
    expect(container.querySelectorAll(".rh-mark-ink")).toHaveLength(3);
    expect(container.querySelectorAll(".rh-mark-accent")).toHaveLength(4);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 24 24");
  });

  it("is decoration unless labelled", () => {
    const { container, rerender } = render(<Mark />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    rerender(<Mark label="RepoHIVE" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-label", "RepoHIVE");
  });

  it("sets the name and the lockup", () => {
    const { container } = render(
      <>
        <Wordmark />
        <Brand markSize={18} />
      </>,
    );
    expect(container.querySelectorAll(".rh-wordmark")).toHaveLength(2);
    expect(container.querySelector(".rh-brand svg")).toHaveAttribute("width", "18");
    expect(container.textContent).toBe("RepoHIVERepoHIVE");
  });
});
