import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColorSource } from "../../canvas/colors";
import { renderWithDesign } from "../../test-utils";
import { zoomMap } from "../map/fixtures";
import { buildCircleModel, pathTo } from "./circle-model";
import { CirclesScreen } from "./circles-screen";

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

/** The fixture's `web` group holds one file, so `web` and `Page.java` are one circle. */
describe("buildCircleModel", () => {
  it("collapses a run of single-child cards into one circle named by the run", () => {
    const model = buildCircleModel(zoomMap());
    const web = model.circles.find((circle) => circle?.label === "web / Page.java");
    expect(web).toBeDefined();
    expect(web?.chain).toHaveLength(2);
    expect(model.circleOf[4]).toBe(model.circleOf[5]);
  });

  it("puts the root on the unit box and every child inside its parent", () => {
    const model = buildCircleModel(zoomMap());
    const root = model.circles[model.root];
    expect(root).toMatchObject({ x: 0.5, y: 0.5, r: 0.5, parent: -1, depth: 0 });
    for (const id of model.order) {
      const circle = model.circles[id];
      const parent = circle === undefined || circle.parent < 0 ? undefined : model.circles[circle.parent];
      if (circle === undefined || parent === undefined) continue;
      expect(Math.hypot(circle.x - parent.x, circle.y - parent.y) + circle.r).toBeLessThanOrEqual(parent.r + 1e-9);
    }
  });

  it("sizes a circle by its recorded file count and lists parents before children", () => {
    const model = buildCircleModel(zoomMap());
    const core = model.circles.find((circle) => circle?.label === "core");
    const web = model.circles.find((circle) => circle?.label === "web / Page.java");
    expect(core!.r).toBeGreaterThan(web!.r);
    expect(model.order.indexOf(core!.id)).toBeGreaterThan(model.order.indexOf(model.root));
  });

  it("gives the same circles for the same input", () => {
    const first = buildCircleModel(zoomMap());
    const second = buildCircleModel(zoomMap());
    expect(second.circles).toEqual(first.circles);
  });

  it("names the way from the root to a circle, and is empty for a map with no cards", () => {
    const model = buildCircleModel(zoomMap());
    const core = model.circles.findIndex((circle) => circle?.label === "core");
    expect(pathTo(model, core)).toEqual([model.root, core]);
    expect(buildCircleModel({ ...zoomMap(), nodes: [] }).order).toEqual([]);
  });
});

describe("CirclesScreen", () => {
  it("draws a labelled, focusable canvas with its tools and legend", () => {
    const { container } = renderWithDesign(<CirclesScreen data={zoomMap()} colors={colors} />);
    const canvas = container.querySelector("canvas");
    expect(canvas).toHaveAttribute("tabindex", "0");
    expect(canvas?.getAttribute("aria-label")).toMatch(/Circle graph/);
    expect(screen.getByRole("textbox", { name: "Find a circle" })).toBeInTheDocument();
    for (const name of ["Zoom in", "Zoom out", "Fit the whole graph"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Selection" })).toBeNull();
    expect(screen.getByText("kept")).toBeInTheDocument();
    expect(screen.getByText("rebuilt")).toBeInTheDocument();
  });
});
