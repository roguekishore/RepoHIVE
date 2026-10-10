import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColorSource } from "./colors";
import type { DrawFrame } from "./controller";
import { useCanvasView } from "./use-canvas-view";

let queue: Array<() => void> = [];

beforeEach(() => {
  queue = [];
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => queue.push(run));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  const ctx = new Proxy({}, { get: (target: Record<string, unknown>, key: string) => (key in target ? target[key] : vi.fn()), set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 300, height: 200 } as DOMRect);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-theme");
});

const flush = (): void => {
  const run = queue;
  queue = [];
  act(() => run.forEach((fn) => fn()));
};

function source(): { colors: ColorSource; set(scheme: "light" | "dark"): void } {
  let scheme: "light" | "dark" = "light";
  return {
    set: (next) => {
      scheme = next;
    },
    colors: {
      computedColor: () => (scheme === "light" ? "rgb(250 250 250)" : "rgb(20 20 20)"),
      computedFont: () => "sans",
    },
  };
}

function Probe({ frames, colors, onReady }: { frames: DrawFrame<string>[]; colors: ColorSource; onReady?: (view: ReturnType<typeof useCanvasView>) => void }) {
  const view = useCanvasView<string>(
    {
      draw: (frame) => {
        frames.push(frame);
      },
      fit: (size) => ({ cx: 0, cy: 0, scale: size.w }),
    },
    colors,
  );
  onReady?.(view);
  return <canvas ref={view.canvasRef} tabIndex={0} aria-label="test canvas" />;
}

describe("useCanvasView", () => {
  it("draws once the canvas and palette exist, and repaints with the new palette when the theme changes", async () => {
    const frames: DrawFrame<string>[] = [];
    const { colors, set } = source();
    render(<Probe frames={frames} colors={colors} />);
    flush();
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.at(-1)?.palette.scheme).toBe("light");

    set("dark");
    await act(async () => {
      document.documentElement.setAttribute("data-theme", "dark");
      await Promise.resolve();
    });
    flush();
    expect(frames.at(-1)?.palette.scheme).toBe("dark");
  });

  it("works under StrictMode, where the controller is created twice", () => {
    const frames: DrawFrame<string>[] = [];
    render(
      <StrictMode>
        <Probe frames={frames} colors={source().colors} />
      </StrictMode>,
    );
    flush();
    expect(frames.length).toBeGreaterThan(0);
  });

  it("hands back a view whose calls reach the controller", () => {
    const frames: DrawFrame<string>[] = [];
    let view: ReturnType<typeof useCanvasView> | undefined;
    render(<Probe frames={frames} colors={source().colors} onReady={(v) => (view = v)} />);
    flush();
    const before = frames.length;
    act(() => view?.invalidate());
    flush();
    expect(frames.length).toBe(before + 1);
    expect(view?.camera()).toEqual({ cx: 0, cy: 0, scale: 300 });
  });
});
