import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PaletteGroup } from "../palette/search-palette";
import { renderWithDesign } from "../test-utils";
import { AppFrame, type AppFrameProps } from "./app-frame";
import { globalNav, repoNav, repoViewLabel } from "./nav";
import { Inspector, StatusLine, Workspace } from "./workspace";

const palette = (): readonly PaletteGroup[] => [
  { label: "Views", items: [{ id: "repos", label: "Repositories", icon: "list", href: "/repos" }] },
];

function frame(props: Partial<AppFrameProps> = {}) {
  return (
    <AppFrame
      pathname="/repos"
      crumbs={[{ label: "Repositories" }]}
      signedIn
      quota={{ remainingAccount: 3, remainingIp: 9, limitAccount: 5, limitIp: 10 }}
      paletteGroups={palette}
      {...props}
    >
      <p>content</p>
    </AppFrame>
  );
}

describe("navigation model", () => {
  it("lists Activity only when asked", () => {
    expect(globalNav(false).map((entry) => entry.label)).toEqual(["Repositories", "Method"]);
    expect(globalNav(true).map((entry) => entry.label)).toEqual(["Repositories", "Activity", "Method"]);
  });

  it("builds the repository group in the plan's order with Circles last, on the unchanged URLs", () => {
    const entries = repoNav("broadleaf", "BroadleafCommerce");
    expect(entries.map((entry) => entry.label)).toEqual([
      "Overview",
      "Map",
      "Hierarchy",
      "Decisions",
      "Architecture",
      "Baseline",
      "Adaptivity",
      "Circles",
    ]);
    expect(entries.map((entry) => entry.href.split("/").pop())).toEqual([
      "overview",
      "knowledge-graph",
      "hierarchy",
      "decision-audit",
      "architecture",
      "flat-baseline",
      "adaptivity",
      "circles",
    ]);
    expect(repoViewLabel("decision-audit")).toBe("Decisions");
  });
});

describe("AppFrame", () => {
  it("renders the landmarks and the content", () => {
    renderWithDesign(frame());
    expect(screen.getByRole("complementary", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("content");
    expect(screen.getByRole("navigation", { name: "Global" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Location" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main-content");
  });

  it("marks the current global page and routes through the host's link", () => {
    renderWithDesign(frame({ pathname: "/method" }));
    const nav = screen.getByRole("navigation", { name: "Global" });
    expect(within(nav).getByRole("link", { name: "Method" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Repositories" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "Repositories" })).toHaveAttribute("data-host-link", "true");
  });

  it("omits Activity by default and lists it when enabled", () => {
    const { unmount } = renderWithDesign(frame());
    expect(screen.queryByRole("link", { name: "Activity" })).not.toBeInTheDocument();
    unmount();
    renderWithDesign(frame({ showActivity: true }));
    expect(screen.getByRole("link", { name: "Activity" })).toHaveAttribute("href", "/activity");
  });

  it("shows no repository group outside a repository", () => {
    renderWithDesign(frame());
    expect(screen.queryByText("Repository")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Overview" })).not.toBeInTheDocument();
  });

  it("shows the repository group inside one, with the current view marked", () => {
    renderWithDesign(frame({ pathname: "/repos/broadleaf/BroadleafCommerce/decision-audit" }));
    const group = screen.getByRole("navigation", { name: "broadleaf/BroadleafCommerce" });
    expect(within(group).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Overview",
      "Map",
      "Hierarchy",
      "Decisions",
      "Architecture",
      "Baseline",
      "Adaptivity",
      "Circles",
    ]);
    expect(within(group).getByRole("link", { name: "Decisions" })).toHaveAttribute("aria-current", "page");
    expect(within(group).getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page")).toHaveLength(1);
  });

  it("treats the bare repository path as the overview", () => {
    renderWithDesign(frame({ pathname: "/repos/broadleaf/BroadleafCommerce" }));
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the day's usage from the quota and links it to the account page", () => {
    renderWithDesign(frame());
    const usage = screen.getByRole("link", { name: /2 of 5 indexes today/ });
    expect(usage).toHaveAttribute("href", "/account");
    expect(screen.getByRole("meter", { name: "Indexes used today" })).toHaveAttribute("aria-valuenow", "2");
  });

  it("offers sign-in instead of a meter when signed out", () => {
    renderWithDesign(frame({ signedIn: false, quota: undefined }));
    expect(screen.getAllByRole("link", { name: /Sign in/ })[0]).toHaveAttribute("href", "/auth/sign-in");
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("shows nothing for usage while the quota is still loading", () => {
    renderWithDesign(frame({ quota: undefined }));
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("switches the theme from the sidebar", async () => {
    renderWithDesign(frame());
    const group = screen.getByRole("group", { name: "Theme" });
    expect(within(group).getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(group).getByRole("button", { name: "Dark" }));
    expect(within(group).getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    document.documentElement.removeAttribute("data-theme");
  });

  it("draws the crumbs, the last one current, earlier ones as links", () => {
    renderWithDesign(
      frame({
        crumbs: [
          { label: "Repositories", href: "/repos" },
          { label: "broadleaf/BroadleafCommerce", href: "/repos/broadleaf/BroadleafCommerce" },
          { label: "Map" },
        ],
      }),
    );
    const crumbs = screen.getByRole("navigation", { name: "Location" });
    expect(within(crumbs).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/repos", "/repos/broadleaf/BroadleafCommerce"]);
    expect(within(crumbs).getByText("Map")).toHaveAttribute("aria-current", "page");
  });

  it("puts the actions in the header and the status line at the foot, when given", () => {
    renderWithDesign(frame({ actions: <button type="button">Index a repository</button>, status: <StatusLine main="2,985 files" aside="Esc clears" /> }));
    expect(screen.getByRole("button", { name: "Index a repository" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toHaveTextContent("2,985 files");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("Esc clears");
  });

  it("has no status line unless given one", () => {
    renderWithDesign(frame());
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });

  it("lets a canvas view fill the column instead of scrolling", () => {
    renderWithDesign(frame({ fill: true }));
    expect(screen.getByRole("main")).toHaveClass("rh-fill");
  });

  it("opens the palette from the sidebar button and from Ctrl+K, and closes it on Escape", async () => {
    renderWithDesign(frame());
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("navigates through the host from a palette choice", async () => {
    const navigate = vi.fn();
    renderWithDesign(frame(), { navigate });
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.keyboard("{Enter}");
    expect(navigate).toHaveBeenCalledWith("/repos");
  });

  it("opens the navigation sheet from the menu button and closes it on Escape and on a path change", async () => {
    const { container, rerender } = renderWithDesign(frame());
    const menu = screen.getByRole("button", { name: "Open navigation" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector(".rh-app")).toHaveClass("rh-nav-open");

    await userEvent.keyboard("{Escape}");
    expect(container.querySelector(".rh-app")).not.toHaveClass("rh-nav-open");

    await userEvent.click(menu);
    rerender(frame({ pathname: "/method" }));
    expect(container.querySelector(".rh-app")).not.toHaveClass("rh-nav-open");
  });
});

describe("Workspace, Inspector, StatusLine", () => {
  it("gives the stage the whole width until something is selected", () => {
    const { container } = renderWithDesign(<Workspace>stage</Workspace>);
    expect(container.querySelector(".rh-view")).not.toHaveClass("rh-has-insp");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("adds the inspector beside the stage and lets it be cleared", async () => {
    const onClose = vi.fn();
    const { container } = renderWithDesign(
      <Workspace
        inspector={
          <Inspector title="core.order" onClose={onClose}>
            <p>detail</p>
          </Inspector>
        }
      >
        stage
      </Workspace>,
    );
    expect(container.querySelector(".rh-view")).toHaveClass("rh-has-insp");
    expect(screen.getByRole("complementary", { name: "Selection" })).toHaveTextContent("core.order");
    await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
