import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColorSource } from "../../canvas/colors";
import { renderWithDesign } from "../../test-utils";
import { buildFlatGraph, placeFlatGraph } from "./flat-model";
import { FlatScreen } from "./flat-screen";
import { GRAPH } from "./test-fixtures";

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

describe("buildFlatGraph", () => {
  it("lists the files in the recorded order and joins each import both ways once", () => {
    const graph = buildFlatGraph(GRAPH);
    expect(graph.names).toEqual(["A.java", "B.java", "C.java", "D.java", "E.java"]);
    expect(graph.folders).toEqual(["src/core", "src/core", "src/core", "src/web", "src/web"]);
    expect(graph.adjacent[0]).toEqual([1, 2, 3]);
    expect(graph.adjacent[3]).toEqual([0]);
    expect(graph.adjacent[4]).toEqual([]);
  });

  it("drops an import of a file the body does not list, and keeps every other recorded import", () => {
    const graph = buildFlatGraph(GRAPH);
    expect(graph.imports).toHaveLength(4);
  });

  it("places the files the same way every time, inside the world", () => {
    const first = placeFlatGraph(buildFlatGraph(GRAPH));
    const second = placeFlatGraph(buildFlatGraph(GRAPH));
    expect([...second.x]).toEqual([...first.x]);
    expect([...second.y]).toEqual([...first.y]);
    for (const value of [...first.x, ...first.y]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1000);
    }
  });
});

describe("FlatScreen", () => {
  it("draws a labelled, focusable canvas and says what is on it", () => {
    const { container } = renderWithDesign(<FlatScreen data={GRAPH} colors={colors} />);
    const canvas = container.querySelector("canvas");
    expect(canvas).toHaveAttribute("tabindex", "0");
    expect(canvas?.getAttribute("aria-label")).toMatch(/Flat dependency graph/);
    expect(screen.getByText("5 files · 4 imports")).toBeInTheDocument();
    expect(screen.getByText("Every file and import, no hierarchy")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Selection" })).toBeNull();
  });

  it("has zoom controls", () => {
    renderWithDesign(<FlatScreen data={GRAPH} colors={colors} />);
    for (const name of ["Zoom in", "Zoom out", "Fit to view"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  });
});
