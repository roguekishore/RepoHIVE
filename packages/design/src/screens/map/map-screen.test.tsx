import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColorSource } from "../../canvas/colors";
import { renderWithDesign } from "../../test-utils";
import { zoomMap } from "./fixtures";
import { MapScreen } from "./map-screen";

const colors: ColorSource = { computedColor: () => "rgb(120 120 120)", computedFont: () => "sans" };

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  const ctx = new Proxy({}, { get: (target: Record<string, unknown>, key: string) => (key in target ? target[key] : vi.fn()), set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 600, height: 400 } as DOMRect);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MapScreen", () => {
  it("draws a focusable, labelled canvas with the tools and the legend, and no inspector until a card is picked", () => {
    const { container } = renderWithDesign(<MapScreen data={zoomMap()} colors={colors} />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute("tabindex", "0");
    expect(canvas?.getAttribute("aria-label")).toMatch(/Scroll to zoom/);
    expect(screen.getByRole("textbox", { name: "Find a card" })).toBeInTheDocument();
    for (const name of ["Zoom in", "Zoom out", "Fit to view"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Selection" })).toBeNull();
    expect(screen.getByText("kept")).toBeInTheDocument();
    expect(screen.getByText("rebuilt")).toBeInTheDocument();
  });

  it("finds a card by name, pins it, and lists what the index recorded about it", async () => {
    const user = userEvent.setup();
    renderWithDesign(<MapScreen data={zoomMap()} colors={colors} />);
    await user.type(screen.getByRole("textbox", { name: "Find a card" }), "web{Enter}");
    const inspector = screen.getByRole("complementary", { name: "Selection" });
    expect(within(inspector).getByRole("heading", { name: "web" })).toBeInTheDocument();
    expect(within(inspector).getByText("Uses")).toBeInTheDocument();
    expect(within(inspector).getByText("Used by")).toBeInTheDocument();
    expect(within(inspector).getByText("Files")).toBeInTheDocument();
  });

  it("clears the selection from the inspector and says so when nothing matches", async () => {
    const user = userEvent.setup();
    renderWithDesign(<MapScreen data={zoomMap()} colors={colors} />);
    await user.type(screen.getByRole("textbox", { name: "Find a card" }), "core{Enter}");
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("complementary", { name: "Selection" })).toBeNull();
    await user.clear(screen.getByRole("textbox", { name: "Find a card" }));
    await user.type(screen.getByRole("textbox", { name: "Find a card" }), "zzz{Enter}");
    expect(screen.getByText('No card named "zzz"')).toBeInTheDocument();
  });
});
