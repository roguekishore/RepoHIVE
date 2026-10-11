import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { renderWithDesign } from "../../test-utils";
import { DecisionsView } from "./decisions";
import { regionDecisions } from "./fixtures";

const SNAPSHOT = "2f866c4d558414aa1c8c5d794c8b9164";
const views = { regionDecisions: regionDecisions() };

function renderView(initialRegionId?: string) {
  return renderWithDesign(<DecisionsView owner="acme" name="widgets" snapshotId={SNAPSHOT} views={views} initialRegionId={initialRegionId} />);
}

// jsdom has no layout: give charts the width a browser would measure.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
});

describe("DecisionsView", () => {
  it("reads the recorded boundary and tallies the recorded actions", () => {
    renderView();
    expect(screen.getByRole("img", { name: /recorded boundary at 0\.50/ })).toBeInTheDocument();
    expect(screen.getByText("3 kept")).toBeInTheDocument();
    expect(screen.getByText("2 rebuilt")).toBeInTheDocument();
    expect(screen.getByText("As recorded")).toBeInTheDocument();
    expect(screen.getByText(/1 regions too small to measure are not shown/)).toBeInTheDocument();
  });

  it("marks kept and rebuilt regions by shape as well as colour", () => {
    renderView();
    const strip = screen.getByRole("img", { name: /recorded boundary/ });
    expect(strip.querySelectorAll("circle.rh-dec-kept")).toHaveLength(3);
    expect(strip.querySelectorAll("rect.rh-dec-rebuilt")).toHaveLength(2);
  });

  it("offers no control that changes a decision", () => {
    renderView();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("opens on the region named in the link and shows its recorded values", () => {
    renderView("pkg:app.data");
    const working = screen.getByRole("heading", { level: 2, name: "app.data" });
    expect(working).toBeInTheDocument();
    expect(screen.getByText("Overridden")).toBeInTheDocument();
  });

  it("falls back to the largest region when the link names one that is not there", () => {
    renderView("pkg:nothing");
    expect(screen.getByRole("heading", { level: 2, name: "app.core" })).toBeInTheDocument();
  });

  it("filters the table by decision and by name", async () => {
    const user = userEvent.setup();
    renderView();
    const table = () => screen.getByRole("table", { name: "All regions" });
    expect(within(table()).getAllByRole("row")).toHaveLength(6);
    await user.click(screen.getByRole("button", { name: "Rebuilt" }));
    expect(within(table()).getAllByRole("row")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.type(screen.getByRole("textbox", { name: "Filter regions" }), "zzz");
    expect(screen.getByText("No regions match. Clear the search or pick another filter.")).toBeInTheDocument();
  });

  it("selects a region from its table row", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(within(screen.getByRole("table", { name: "All regions" })).getByText("app.web"));
    expect(screen.getByRole("heading", { level: 2, name: "app.web" })).toBeInTheDocument();
  });
});
