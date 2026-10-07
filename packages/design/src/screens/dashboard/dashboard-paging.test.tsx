import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ContractClient, RepositoryListItem } from "../../contracts";
import { renderWithDesign, stubClient } from "../../test-utils";
import { DASHBOARD_PAGE_SIZE } from "./cards";
import { Dashboard } from "./dashboard";
import type { DashboardFrameProps } from "./frame-prop";

const Frame = ({ children }: DashboardFrameProps) => <div>{children}</div>;

const repo = (index: number): RepositoryListItem => {
  const name = `repo-${String(index).padStart(3, "0")}`;
  return {
    repoKey: `github.com/acme/${name}`,
    repoId: `acme/${name}`,
    snapshotId: index.toString(16).padStart(32, "0"),
    commitSha: "c".repeat(40),
    // A later index is a newer index, so "recently indexed" lists repo-059 first.
    indexedAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    nodeCount: 10,
  };
};

const ALL = Array.from({ length: 60 }, (_, index) => repo(index));

/** Counts the snapshots read: the dashboard must read only what it draws. */
function countingClient() {
  const view = vi.fn((_snapshotId: string, _name: string) => Promise.reject(new Error("no figures")));
  return { view, client: stubClient({ view: view as unknown as ContractClient["view"] }) };
}

describe("Dashboard paging", () => {
  it("draws one page of cards and reads only that page's snapshots", async () => {
    const { client, view } = countingClient();
    renderWithDesign(<Dashboard Frame={Frame} repositories={ALL} />, { client });
    expect(screen.getAllByRole("listitem")).toHaveLength(DASHBOARD_PAGE_SIZE);
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    await waitFor(() => expect(view).toHaveBeenCalledTimes(DASHBOARD_PAGE_SIZE));
    expect(view.mock.calls.every(([snapshotId]) => ALL.some((item) => item.snapshotId === snapshotId))).toBe(true);
  });

  it("moves between pages, and the first page has no Previous", async () => {
    const user = userEvent.setup();
    const { client } = countingClient();
    renderWithDesign(<Dashboard Frame={Frame} repositories={ALL} />, { client });
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(60 - 2 * DASHBOARD_PAGE_SIZE);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("starts again from the first page when the filter changes, and hides the pager when one page is enough", async () => {
    const user = userEvent.setup();
    const { client } = countingClient();
    renderWithDesign(<Dashboard Frame={Frame} repositories={ALL} />, { client });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByRole("textbox", { name: "Filter by owner or name" }), "repo-05");
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(10);
    expect(screen.queryByRole("navigation", { name: "Repository pages" })).toBeNull();
  });
});
