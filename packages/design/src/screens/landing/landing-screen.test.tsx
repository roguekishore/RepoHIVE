import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithDesign as render, stubClient } from "../../test-utils";
import { BROADLEAF_FIGURES as F } from "./broadleaf-figures";
import { LandingScreen } from "./landing-screen";

const number = new Intl.NumberFormat("en-US");

vi.mock("../../canvas/use-canvas-palette", async () => {
  const { readPalette } = await import("../../canvas/colors");
  const palette = readPalette({ computedColor: () => "rgb(120 120 120)", computedFont: () => "sans" });
  return { useCanvasPalette: () => palette };
});

const renderWithDesign = (ui: React.ReactElement) => render(ui, { client: stubClient() });

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  vi.stubGlobal("IntersectionObserver", class { observe(): void {} disconnect(): void {} });
  const ctx = new Proxy({}, { get: (target: Record<string, unknown>, key: string) => (key in target ? target[key] : vi.fn()), set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 500 } as DOMRect);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LandingScreen", () => {
  it("leads with the headline, the film and the way to sign in", () => {
    renderWithDesign(<LandingScreen figures={F} />);
    expect(screen.getByRole("heading", { level: 1, name: "Read a codebase by the way it is actually built." })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: new RegExp(`film of RepoHIVE indexing ${F.repository}`) })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/sign-in");
    expect(screen.getByRole("group", { name: "Film chapters" })).toBeInTheDocument();
  });

  it("shows only figures the committed index recorded", () => {
    renderWithDesign(<LandingScreen figures={F} />);
    for (const value of [F.counts.files, F.counts.nodes, F.counts.edges, F.counts.regions]) {
      expect(screen.getAllByText(number.format(value)).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(`${(F.counts.preserveShare * 100).toFixed(1)}%`, { selector: "p, span, div" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: new RegExp(`${F.counts.preserved} kept, ${F.counts.reconstructed} rebuilt, ${F.counts.degenerate} too small to measure`) })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(F.signal.level))).toBeInTheDocument();
  });

  it("draws one waffle square per region, with kept, rebuilt and too-small told apart by shape", () => {
    const { container } = renderWithDesign(<LandingScreen figures={F} />);
    expect(container.querySelectorAll("rect.rh-ld-sq-kept")).toHaveLength(F.counts.preserved);
    expect(container.querySelectorAll("rect.rh-ld-sq-rebuilt")).toHaveLength(F.counts.reconstructed);
    expect(container.querySelectorAll("rect.rh-ld-sq-small")).toHaveLength(F.counts.degenerate);
  });

  it("labels the boundary as a what-if and counts the decisions that would change", () => {
    renderWithDesign(<LandingScreen figures={F} />);
    expect(screen.getByText("As recorded")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is re-indexed/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "Boundary" }), { target: { value: "0.8" } });
    expect(screen.getByText(/^\d[\d,]* would change$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Reset to ${F.settings.boundary.toFixed(2)}` })).toBeInTheDocument();
  });

  it("shows the recorded values of the featured rebuilt region", () => {
    renderWithDesign(<LandingScreen figures={F} />);
    const row = F.regions.find((r) => r[0] === F.featured.rebuilt)!;
    const working = screen.getByRole("heading", { level: 3, name: row[0] }).closest("section")!;
    expect(within(working).getByText(row[4].toFixed(3))).toBeInTheDocument();
  });

  it("checks what is typed in the index form before it asks anything of the server", async () => {
    const user = userEvent.setup();
    renderWithDesign(<LandingScreen figures={F} />);
    const [form] = screen.getAllByRole("textbox", { name: "Repository" });
    const submit = screen.getAllByRole("button", { name: "Index it" })[0]!;
    await user.click(submit);
    expect(screen.getAllByText("Enter a repository, for example apache/kafka.").length).toBeGreaterThan(0);
    await user.type(form!, "not a repo");
    await user.click(submit);
    expect(screen.getAllByText("Use owner/repo or a github.com link, for example apache/kafka.").length).toBeGreaterThan(0);
    expect(form).toHaveAttribute("aria-invalid", "true");
  });

  it("lists the five index files with their recorded hashes", () => {
    renderWithDesign(<LandingScreen figures={F} />);
    const table = screen.getByRole("table", { name: "The index files and their hashes" });
    expect(within(table).getAllByRole("row")).toHaveLength(F.determinism.files.length + 1);
    expect(within(table).getByText(`${F.determinism.files[0]!.sha256.slice(0, 12)}…`)).toBeInTheDocument();
  });
});
