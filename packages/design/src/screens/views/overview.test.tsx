import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ContractClient } from "../../contracts";
import { renderWithDesign, stubClient } from "../../test-utils";
import { adaptivity, hierarchyScale, regionDecisions } from "./fixtures";
import { OverviewActions, OverviewScreen, OverviewView } from "./overview";

const SNAPSHOT = "2f866c4d558414aa1c8c5d794c8b9164";

function viewsClient(overrides: Partial<ContractClient> = {}): ContractClient {
  const bodies = { adaptivity: adaptivity(), regionDecisions: regionDecisions(), hierarchyScale: hierarchyScale() };
  return stubClient({
    view: ((_snapshot: string, name: keyof typeof bodies) => Promise.resolve(bodies[name])) as ContractClient["view"],
    repository: () => Promise.resolve({ repo: "acme/widgets", snapshotId: SNAPSHOT, commitSha: "5036306fcbd9", nodeCount: 20000, indexedAt: "2026-10-01T19:15:55.180Z" }),
    manifest: () =>
      Promise.resolve({ manifestVersion: 1, repo: "github.com/acme/widgets", commitSha: "5036306fcbd9", engineVersion: "e2173a5f", viewsVersion: "c356e4f8", indexFormatVersion: 1, files: [] }),
    ...overrides,
  });
}

const views = { adaptivity: adaptivity(), regionDecisions: regionDecisions(), hierarchyScale: hierarchyScale() };

describe("OverviewView", () => {
  it("shows the recorded figures, the split, and no number the views did not hold", () => {
    renderWithDesign(<OverviewView owner="acme" name="widgets" snapshotId={SNAPSHOT} views={views} />);
    expect(screen.getByRole("heading", { level: 1, name: "widgets" })).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument(); // files
    expect(screen.getByText("20,000")).toBeInTheDocument(); // nodes
    expect(screen.getByText("15,000")).toBeInTheDocument(); // edges
    expect(screen.getByText("60.0%")).toBeInTheDocument(); // the recorded preserveShare
    expect(screen.getByRole("img", { name: "3 kept, 2 rebuilt, 1 not assessed" })).toBeInTheDocument();
    expect(screen.getByText(/5 of 6 regions were large enough to measure\. 3 kept their package/)).toBeInTheDocument();
  });

  it("draws the three decisions with different marks, not by colour alone", () => {
    renderWithDesign(<OverviewView owner="acme" name="widgets" snapshotId={SNAPSHOT} views={views} />);
    expect(document.querySelector(".rh-glyph-kept")).not.toBeNull();
    expect(document.querySelector(".rh-glyph-rebuilt")).not.toBeNull();
    expect(document.querySelector(".rh-glyph-unassessed")).not.toBeNull();
  });

  it("lists the largest assessed regions by files and leaves the unassessed one out", () => {
    renderWithDesign(<OverviewView owner="acme" name="widgets" snapshotId={SNAPSHOT} views={views} />);
    const table = screen.getByRole("table", { name: "Largest regions" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual(["core", "web", "data", "util", "edge"]);
    expect(within(rows[0]!).getByText("0.620")).toBeInTheDocument(); // the recorded score
    expect(within(table).queryByText("tiny")).toBeNull();
  });

  it("links each close call to the Decisions page with that region picked", () => {
    renderWithDesign(<OverviewView owner="acme" name="widgets" snapshotId={SNAPSHOT} views={views} />);
    const link = screen.getByRole("link", { name: /data/ });
    expect(link).toHaveAttribute("href", "/repos/acme/widgets/decision-audit?region=pkg%3Aapp.data");
    expect(screen.getByText("Smallest margin from the 0.5 boundary")).toBeInTheDocument();
  });

  it("opens Decisions from a table row", async () => {
    const navigate = vi.fn();
    renderWithDesign(<OverviewView owner="acme" name="widgets" snapshotId={SNAPSHOT} views={views} />, { navigate });
    await userEvent.click(within(screen.getByRole("table", { name: "Largest regions" })).getByText("web"));
    expect(navigate).toHaveBeenCalledWith("/repos/acme/widgets/decision-audit?region=pkg%3Aapp.web");
  });

  it("reads the snapshot panel from the manifest and the views, and hides what was not recorded", () => {
    const noSeed = { ...views, regionDecisions: { ...views.regionDecisions, seed: null } };
    renderWithDesign(<OverviewView owner="acme" name="widgets" snapshotId={SNAPSHOT} views={noSeed} />);
    expect(screen.queryByText("Seed")).toBeNull();
    expect(screen.queryByText("Index format")).toBeNull(); // no manifest given
    expect(screen.getByText("6 levels")).toBeInTheDocument(); // the recorded depth
    expect(screen.getByText("20 files")).toBeInTheDocument();
  });

  it("shows the index date only when the facts describe this snapshot", () => {
    const summary = { repo: "acme/widgets", snapshotId: SNAPSHOT, commitSha: "5036306fcbd9", nodeCount: 1, indexedAt: "2026-10-01T19:15:55.180Z" };
    const { unmount } = renderWithDesign(<OverviewView owner="acme" name="widgets" snapshotId={SNAPSHOT} views={views} summary={summary} />);
    expect(screen.getByText(/Indexed 1 Oct 2026/)).toBeInTheDocument();
    unmount();
    renderWithDesign(<OverviewView owner="acme" name="widgets" snapshotId={"f".repeat(32)} views={views} summary={summary} />);
    expect(screen.queryByText(/Indexed/)).toBeNull();
  });

  it("scales the depth rows on a log axis from the recorded node counts", () => {
    renderWithDesign(<OverviewView owner="acme" name="widgets" snapshotId={SNAPSHOT} views={views} />);
    const bars = Array.from(document.querySelectorAll<HTMLElement>(".rh-v-level i")).map((bar) => bar.style.width);
    expect(bars).toEqual(["0%", "33.33333333333333%", "100%"]);
    expect(screen.getByText("1,000")).toBeInTheDocument();
  });

  it("says so when the snapshot recorded no figures for the repository", () => {
    const empty = { ...views, adaptivity: { ...views.adaptivity, repos: [] } };
    renderWithDesign(<OverviewView owner="acme" name="widgets" snapshotId={SNAPSHOT} views={empty} />);
    expect(screen.getByText(/recorded no figures/)).toBeInTheDocument();
  });
});

describe("OverviewScreen", () => {
  it("waits while the snapshot resolves", () => {
    renderWithDesign(<OverviewScreen owner="acme" name="widgets" snapshot={{ status: "loading" }} />, { client: viewsClient() });
    expect(screen.getByText(/Loading the overview/)).toBeInTheDocument();
  });

  it("explains a repository that was never indexed", () => {
    renderWithDesign(<OverviewScreen owner="acme" name="widgets" snapshot={{ status: "never-indexed" }} />, { client: viewsClient() });
    expect(screen.getByText("This repository has not been indexed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to repositories" })).toHaveAttribute("href", "/repos");
  });

  it("offers the latest snapshot when the one asked for is gone", () => {
    renderWithDesign(<OverviewScreen owner="acme" name="widgets" snapshot={{ status: "expired", requested: "x" }} />, { client: viewsClient() });
    expect(screen.getByRole("link", { name: "Open the latest snapshot" })).toHaveAttribute("href", "/repos/acme/widgets");
  });

  it("reports a snapshot that could not be resolved", () => {
    renderWithDesign(<OverviewScreen owner="acme" name="widgets" snapshot={{ status: "error", message: "Offline" }} />, { client: viewsClient() });
    expect(screen.getByRole("alert")).toHaveTextContent("Offline");
  });

  it("loads the three views and the facts through the client, then draws", async () => {
    const view = vi.fn((_snapshot: string, name: string) => Promise.resolve(views[name as keyof typeof views]));
    renderWithDesign(<OverviewScreen owner="acme" name="widgets" snapshot={{ status: "ready", snapshotId: SNAPSHOT, source: "latest" }} />, { client: viewsClient({ view: view as unknown as ContractClient["view"] }) });
    expect(await screen.findByText("1,234")).toBeInTheDocument();
    expect(view.mock.calls.map((call) => call[1]).sort()).toEqual(["adaptivity", "hierarchyScale", "regionDecisions"]);
    await waitFor(() => expect(screen.getByText(/Indexed 1 Oct 2026/)).toBeInTheDocument());
    expect(screen.getByText("Version 1, five files")).toBeInTheDocument();
  });

  it("shows a failed view read, and still draws when only the facts fail", async () => {
    const failing = viewsClient({ view: (() => Promise.reject(new Error("Gone"))) as ContractClient["view"] });
    const { unmount } = renderWithDesign(<OverviewScreen owner="acme" name="widgets" snapshot={{ status: "ready", snapshotId: SNAPSHOT, source: "latest" }} />, { client: failing });
    expect(await screen.findByRole("alert")).toHaveTextContent("Gone");
    unmount();
    const noFacts = viewsClient({ repository: () => Promise.reject(new Error("x")), manifest: () => Promise.reject(new Error("x")) });
    renderWithDesign(<OverviewScreen owner="acme" name="widgets" snapshot={{ status: "ready", snapshotId: SNAPSHOT, source: "latest" }} />, { client: noFacts });
    expect(await screen.findByText("1,234")).toBeInTheDocument();
    expect(screen.queryByText("Index format")).toBeNull();
  });
});

describe("OverviewActions", () => {
  it("opens the map", () => {
    renderWithDesign(<OverviewActions owner="acme" name="widgets" />, { client: viewsClient() });
    expect(screen.getByRole("link", { name: "Open map" })).toHaveAttribute("href", "/repos/acme/widgets/knowledge-graph");
  });

  it("follows a re-index to its job", async () => {
    const navigate = vi.fn();
    const requestIndex = vi.fn(() => Promise.resolve({ status: "accepted" as const, jobId: "job-1" }));
    renderWithDesign(<OverviewActions owner="acme" name="widgets" />, { client: viewsClient({ requestIndex }), navigate });
    await userEvent.click(screen.getByRole("button", { name: "Re-index" }));
    expect(requestIndex).toHaveBeenCalledWith("acme/widgets");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/jobs/job-1"));
  });

  it("says why when the request is not accepted", async () => {
    const requestIndex = vi.fn(() => Promise.resolve({ status: "busy" as const, retryAfterSeconds: 30 }));
    renderWithDesign(<OverviewActions owner="acme" name="widgets" />, { client: viewsClient({ requestIndex }) });
    await userEvent.click(screen.getByRole("button", { name: "Re-index" }));
    expect(await screen.findByText("The service is busy. Try again in 30 seconds.")).toBeInTheDocument();
  });
});
