import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithDesign } from "../../test-utils";
import { MethodScreen } from "./method-screen";

describe("MethodScreen", () => {
  it("has the article, its six sections and the seven views", () => {
    renderWithDesign(<MethodScreen />);
    expect(screen.getByRole("heading", { level: 1, name: "How RepoHIVE builds a hierarchy" })).toBeInTheDocument();
    for (const title of ["Regions", "Scoring a region", "Kept or rebuilt", "Regions too small to measure", "Same input, same output", "The views"]) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
  });

  it("states the rules without any repository's figures", () => {
    const { container } = renderWithDesign(<MethodScreen />);
    expect(container.textContent).not.toMatch(/Broadleaf/i);
    expect(container.textContent).not.toMatch(/\d{1,3},\d{3}/);
  });

  it("lists the sections in the table of contents and scrolls to one", async () => {
    const user = userEvent.setup();
    const scrolled: string[] = [];
    window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) {
      scrolled.push(this.id);
    };
    renderWithDesign(<MethodScreen />);
    const toc = screen.getByRole("navigation", { name: "On this page" });
    expect(within(toc).getAllByRole("link")).toHaveLength(6);
    await user.click(within(toc).getByRole("link", { name: "Scoring a region" }));
    expect(scrolled).toEqual(["m-score"]);
  });
});
