import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithDesign as render, stubClient } from "../../test-utils";
import { BROADLEAF_FIGURES as F } from "../landing/broadleaf-figures";
import { HiveLanding } from "./hive-landing";

const renderPage = () => render(<HiveLanding figures={F} />, { client: stubClient({ quota: () => new Promise(() => undefined) }) });

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  vi.stubGlobal("IntersectionObserver", class { observe(): void {} disconnect(): void {} });
  const ctx = new Proxy({ getImageData: () => ({ data: [0, 0, 0, 255] }) }, { get: (target: Record<string, unknown>, key: string) => (key in target ? target[key] : vi.fn()), set: () => true });
  // 2D works (the view previews); WebGL does not, as in jsdom, so the page must fall back.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((type: string) => (type.startsWith("webgl") ? null : ctx)) as never);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 500 } as DOMRect);
  // jsdom has no WebGL, and three.js reports that on the console before it throws; the page turns it into the fallback.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  // Unmount first, so nothing still loading finds the mocks gone.
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HiveLanding", () => {
  it("leads with the headline and the hero copy, and wires the page's links to the app's routes", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The hive inside your hairball.");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/sign-in");
    const repos = screen.getAllByRole("link").filter((link) => link.getAttribute("href") === "/repos");
    expect(repos.map((link) => link.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Explore",
      "Explore repositories →",
      "Repositories",
    ]);
    expect(screen.getByRole("link", { name: "Index" })).toHaveAttribute("href", "#start");
  });

  it("has no section links in the nav or footer, and a toggle that flips the theme", async () => {
    renderPage();
    for (const name of ["How it works", "Views", "Determinism"]) expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Switch to dark theme" });
    await userEvent.click(toggle);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    await userEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    document.documentElement.removeAttribute("data-theme");
  });

  it("states only figures the committed index recorded", () => {
    renderPage();
    const c = F.counts;
    expect(screen.getByText(`Kept, ${c.preserved}`)).toBeInTheDocument();
    expect(screen.getByText(`Rebuilt, ${c.reconstructed}`)).toBeInTheDocument();
    expect(screen.getByText(`Too small, ${c.degenerate}`)).toBeInTheDocument();
    expect(screen.getByText(`${c.files.toLocaleString("en-US")} files pack into a honeycomb`, { exact: false })).toBeInTheDocument();
  });

  it("gives each step of the animation one line of copy, and starts on the first", () => {
    renderPage();
    const phases = [...document.querySelectorAll(".hv-phase")];
    expect(phases.map((p) => p.querySelector("h1, h2")?.textContent)).toEqual([
      "The hive inside your hairball.",
      "Every file gets a cell.",
      "Keep what holds. Rebuild the rest.",
      "Read it like a core sample.",
      "Your codebase, in layers.",
    ]);
    expect(phases[0]).toHaveClass("on");
    expect(screen.getByText("Structure maps for Java repositories on GitHub.").closest(".hv-phase")).toHaveClass("on");
  });

  it("labels the strata the way the design does", () => {
    renderPage();
    // Once for the animation and once for the explorer.
    for (const text of ["Repository · 2,985 files", "Level 1 · 2 groups", "Level 2 · 26 groups", "Level 3 · 292 pieces", "Level 4 · 344 pieces"]) {
      expect(screen.getAllByText((_, el) => el?.classList.contains("hv-strata-tag") === true && el.textContent === text)).toHaveLength(2);
    }
  });

  it("shows the fallback where WebGL is missing, for both pictures", async () => {
    // Everything counts as on screen, so the explorer is built as well as the animation.
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private readonly onChange: (entries: unknown[]) => void) {}
        observe(target: Element): void {
          this.onChange([{ isIntersecting: true, target }]);
        }
        disconnect(): void {}
      },
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("This picture needs WebGL. The story below still reads in full.")).toBeVisible());
    await waitFor(() => expect(screen.getByText("This explorer needs WebGL.")).toBeVisible());
  });

  it("builds the explorer's scene only once it is near the viewport", async () => {
    // The default observer here never reports anything: the explorer is far below the fold.
    renderPage();
    await waitFor(() => expect(screen.getByText("This picture needs WebGL. The story below still reads in full.")).toBeVisible());
    expect(screen.getByText("This explorer needs WebGL.")).not.toBeVisible();
  });

  it("lists the seven views and says what the first one answers", () => {
    renderPage();
    const list = document.querySelector(".hv-deck-list") as HTMLElement;
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual(["Map", "Decisions", "Hierarchy", "Architecture", "Baseline", "Overview", "Adaptivity"]);
    expect(document.querySelector(".hv-deck-now")).toHaveTextContent("Zoom from the whole repository into regions, groups and files.");
  });
});

describe("the explorer's controls", () => {
  it("starts spread out, on every level, at an angle", () => {
    renderPage();
    expect(screen.getByRole("slider", { name: "Spread" })).toHaveValue("100");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Angle" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Repository", { selector: ".hv-label" })).toBeInTheDocument();
  });

  it("isolates a level, changes the view, and resets", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "3" }));
    expect(screen.getByRole("button", { name: "3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Above" }));
    expect(screen.getByRole("button", { name: "Above" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Angle" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(screen.getByRole("slider", { name: "Spread" }), { target: { value: "20" } });
    expect(screen.getByRole("slider", { name: "Spread" })).toHaveValue("20");

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("slider", { name: "Spread" })).toHaveValue("100");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Angle" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reads the repository until a piece is picked", () => {
    renderPage();
    const panel = document.querySelector(".hv-xp-read") as HTMLElement;
    expect(within(panel).getByText("2,985")).toBeInTheDocument();
    expect(within(panel).getByText("100% of the repository")).toBeInTheDocument();
    expect(within(panel).getByText("2 groups on level 1")).toBeInTheDocument();
  });

  it("gives the 3D canvas a keyboard route and a description", () => {
    renderPage();
    const canvas = screen.getByLabelText(/Explorable 3D model/);
    expect(canvas).toHaveAttribute("tabindex", "0");
    expect(canvas).toHaveAttribute("aria-describedby", "xp-keys");
    expect(document.getElementById("xp-keys")).toHaveTextContent("Arrow keys to turn and tilt");
  });
});

describe("the index form", () => {
  it("checks what is typed before it opens the request dialog", async () => {
    const user = userEvent.setup();
    renderPage();
    const [input] = screen.getAllByRole("textbox", { name: "Repository" });
    const submit = screen.getAllByRole("button", { name: "Index it" })[0]!;
    await user.click(submit);
    expect(screen.getByText("Enter a repository, for example apache/kafka.")).toBeInTheDocument();
    await user.type(input!, "not a repo");
    await user.click(submit);
    expect(screen.getByText("Use owner/repo or a github.com link, for example apache/kafka.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the request dialog for a good repository, outside the animation's transformed layer", async () => {
    const user = userEvent.setup();
    renderPage();
    const [input] = screen.getAllByRole("textbox", { name: "Repository" });
    await user.type(input!, "https://github.com/apache/kafka.git");
    await user.click(screen.getAllByRole("button", { name: "Index it" })[0]!);
    expect(screen.getByText("apache/kafka looks right.")).toBeInTheDocument();
    const dialog = await screen.findByRole("dialog");
    // Transformed ancestors trap `position: fixed`, so the dialog must not sit inside a phase of the animation.
    expect(dialog.closest(".hv-phase")).toBeNull();
    expect(dialog.closest(".rh-hv")).not.toBeNull();
  });
});
