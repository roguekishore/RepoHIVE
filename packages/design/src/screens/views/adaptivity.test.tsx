import { screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import type { ViewBodies } from "../../contracts";
import { renderWithDesign } from "../../test-utils";
import { AdaptivityView } from "./adaptivity";
import { adaptivity, regionDecisions } from "./fixtures";

const SNAPSHOT = "2f866c4d558414aa1c8c5d794c8b9164";

function renderView(adaptivityBody: ViewBodies["adaptivity"] = adaptivity()) {
  return renderWithDesign(<AdaptivityView owner="acme" name="widgets" snapshotId={SNAPSHOT} views={{ adaptivity: adaptivityBody, regionDecisions: regionDecisions() }} />);
}

// jsdom has no layout: give charts the width a browser would measure.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
});

describe("AdaptivityView", () => {
  it("leads with the recorded kept share", () => {
    renderView();
    expect(screen.getByText("60.0%")).toBeInTheDocument();
    expect(screen.getByText(/of assessed regions kept their authored package \(3 of 5\)/)).toBeInTheDocument();
  });

  it("draws the histogram from the recorded scores, kept and rebuilt apart", () => {
    renderView();
    const chart = screen.getByRole("img", { name: "Histogram of region scores" });
    expect(chart.querySelectorAll("rect.rh-dec-kept").length).toBeGreaterThan(0);
    expect(chart.querySelectorAll("rect.rh-ad-rebuilt-bar").length).toBeGreaterThan(0);
    expect(screen.getByText("boundary 0.50")).toBeInTheDocument();
  });

  it("states the coverage and what it leaves out", () => {
    renderView();
    expect(screen.getByRole("img", { name: "5 regions assessed, 1 too small to measure" })).toBeInTheDocument();
    expect(screen.getByText(/scores 0 by rule and is rebuilt without assessment/)).toBeInTheDocument();
  });

  it("lists the recorded configuration", () => {
    renderView();
    expect(screen.getByText("Squash constant")).toBeInTheDocument();
    expect(screen.getByText("Recorded with the snapshot")).toBeInTheDocument();
  });

  it("shows the empty comparison for one repository", () => {
    renderView();
    expect(screen.getByText("Comparison appears when two or more repositories are indexed.")).toBeInTheDocument();
  });

  it("compares repositories on one axis when the view holds several", () => {
    const first = adaptivity();
    const other = adaptivity("acme/other").repos[0]!;
    renderView({ ...first, repos: [...first.repos, other] });
    expect(screen.queryByText("Comparison appears when two or more repositories are indexed.")).toBeNull();
    expect(screen.getByRole("img", { name: /acme\/other: .* kept, of assessed/ })).toBeInTheDocument();
  });

  it("says so when the snapshot recorded nothing for the repository", () => {
    renderView({ ...adaptivity(), repos: [] });
    expect(screen.getByText(/recorded no figures for acme\/widgets/)).toBeInTheDocument();
  });
});
