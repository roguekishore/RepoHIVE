import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Camera } from "./camera";
import type { CanvasPalette, Rgba } from "./colors";
import { CanvasController, type CanvasViewOptions, type DrawFrame } from "./controller";
import { fallbackTextSizes } from "./text";
import { COLOR_TOKENS, type ColorToken } from "../tokens/names";

const colour: Rgba = { r: 10, g: 20, b: 30, a: 1 };
const palette: CanvasPalette = {
  colors: Object.fromEntries(COLOR_TOKENS.map((token) => [token, colour])) as Record<ColorToken, Rgba>,
  sans: "sans",
  mono: "mono",
  scheme: "light",
};

interface Harness {
  canvas: HTMLCanvasElement;
  ctx: Record<string, unknown>;
  frames: DrawFrame<string>[];
  options: CanvasViewOptions<string> & {
    onHover: ReturnType<typeof vi.fn>;
    onPick: ReturnType<typeof vi.fn>;
    onOpen: ReturnType<typeof vi.fn>;
    onCamera: ReturnType<typeof vi.fn>;
    onActive: ReturnType<typeof vi.fn>;
  };
  box: { width: number; height: number };
  controller: CanvasController<string>;
  /** Runs every queued animation frame at time `now`. */
  flush(now?: number): void;
  resize(width: number, height: number): void;
}

let queue: Array<{ id: number; run: (now: number) => void }> = [];
let nextId = 1;
let clock = 0;
let observers: Array<() => void> = [];
let reduced = false;

beforeEach(() => {
  queue = [];
  nextId = 1;
  clock = 0;
  observers = [];
  reduced = false;
  vi.stubGlobal("requestAnimationFrame", (run: (now: number) => void) => {
    const id = nextId++;
    queue.push({ id, run });
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    queue = queue.filter((entry) => entry.id !== id);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduced-motion") ? reduced : false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(overrides: Partial<CanvasViewOptions<string>> = {}, box = { width: 400, height: 300 }): Harness {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const ctx: Record<string, unknown> = new Proxy(
    {},
    {
      get: (target: Record<string, unknown>, key: string) => {
        if (key === "measureText") return (text: string) => ({ width: text.length * 6 });
        return key in target ? target[key] : vi.fn();
      },
      set: (target: Record<string, unknown>, key: string, value: unknown) => {
        target[key] = value;
        return true;
      },
    },
  );
  canvas.getContext = (() => ctx) as unknown as HTMLCanvasElement["getContext"];
  const harness = { box } as Harness;
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, right: 0, bottom: 0, x: 10, y: 20, toJSON: () => ({}), ...harness.box }) as DOMRect;
  const frames: DrawFrame<string>[] = [];
  const options = {
    draw: (frame: DrawFrame<string>) => {
      frames.push(frame);
      // One card covering the left half of the viewport, drawn on top of nothing.
      frame.hits.addRect(0, 0, frame.width / 2, frame.height, "left");
    },
    fit: (size): Camera => ({ cx: 0.5, cy: 0.5, scale: Math.min(size.w, size.h) }),
    onHover: vi.fn(),
    onPick: vi.fn(),
    onOpen: vi.fn(),
    onCamera: vi.fn(),
    onActive: vi.fn(),
    ...overrides,
  } as Harness["options"];
  const controller = new CanvasController<string>(canvas, () => options);
  Object.assign(harness, {
    canvas,
    ctx,
    frames,
    options,
    controller,
    flush: (now = 0) => {
      clock = now;
      const run = queue;
      queue = [];
      for (const entry of run) entry.run(now);
    },
    resize: (width: number, height: number) => {
      harness.box = { width, height };
      for (const notify of observers) notify();
    },
  });
  controller.setAppearance(palette, fallbackTextSizes());
  return harness;
}

function pointer(canvas: HTMLElement, type: string, x: number, y: number, extra: Partial<MouseEventInit> & { pointerId?: number } = {}): void {
  const { pointerId, ...init } = extra;
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x + 10, clientY: y + 20, button: 0, ...init });
  Object.assign(event, { pointerId: pointerId ?? 1 });
  canvas.dispatchEvent(event);
}

describe("sizing and drawing", () => {
  it("sizes the canvas to its box times the device pixel ratio, capped", () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 3, configurable: true });
    const h = setup();
    expect(h.canvas.width).toBe(800);
    expect(h.canvas.height).toBe(600);
    expect(h.controller.viewport).toEqual({ w: 400, h: 300 });
    h.controller.destroy();
  });

  it("follows the device pixel ratio when it is below the cap", () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 1.5, configurable: true });
    const h = setup();
    expect(h.canvas.width).toBe(600);
    h.controller.destroy();
  });

  it("fits the camera on the first measure and paints once, with the palette, on the next frame", () => {
    const h = setup();
    expect(h.controller.camera).toEqual({ cx: 0.5, cy: 0.5, scale: 300 });
    expect(h.frames).toHaveLength(0);
    h.flush();
    expect(h.frames).toHaveLength(1);
    expect(h.frames[0]?.palette).toBe(palette);
    expect(h.frames[0]?.dpr).toBe(1);
    expect(h.frames[0]?.toScreen({ x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 50, y: 0, w: 300, h: 300 });
    expect(h.options.onCamera).toHaveBeenCalledTimes(1);
    h.controller.destroy();
  });

  it("coalesces repaint requests into one frame", () => {
    const h = setup();
    h.flush();
    h.controller.invalidate();
    h.controller.invalidate();
    h.controller.invalidate();
    h.flush();
    expect(h.frames).toHaveLength(2);
    h.controller.destroy();
  });

  it("repaints with the new palette when the appearance changes, which is how a theme change is repainted", () => {
    const h = setup();
    h.flush();
    const dark: CanvasPalette = { ...palette, scheme: "dark" };
    h.controller.setAppearance(dark, fallbackTextSizes());
    h.flush();
    expect(h.frames.at(-1)?.palette.scheme).toBe("dark");
    h.controller.destroy();
  });

  it("draws nothing until it has an appearance", () => {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    canvas.getContext = (() => ({})) as unknown as HTMLCanvasElement["getContext"];
    const draw = vi.fn();
    const controller = new CanvasController<string>(canvas, () => ({ draw, fit: () => ({ cx: 0, cy: 0, scale: 1 }) }));
    queue.forEach((entry) => entry.run(0));
    expect(draw).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("re-fits on resize until the user moves the camera, then keeps it", () => {
    const h = setup();
    h.resize(200, 100);
    expect(h.controller.camera.scale).toBe(100);
    h.controller.setCamera({ cx: 0.2, cy: 0.2, scale: 999 });
    h.resize(500, 500);
    expect(h.controller.camera).toEqual({ cx: 0.2, cy: 0.2, scale: 999 });
    expect(h.canvas.width).toBe(500);
    h.controller.destroy();
  });
});

describe("pointer", () => {
  it("reports the hit under the pointer and clears it, with the over class for the cursor", () => {
    const h = setup();
    h.flush();
    pointer(h.canvas, "pointermove", 50, 50);
    expect(h.options.onHover).toHaveBeenLastCalledWith("left");
    expect(h.canvas.classList.contains("rh-over")).toBe(true);
    pointer(h.canvas, "pointermove", 300, 50);
    expect(h.options.onHover).toHaveBeenLastCalledWith(undefined);
    expect(h.canvas.classList.contains("rh-over")).toBe(false);
    h.controller.destroy();
  });

  it("does not repeat a hover that has not changed", () => {
    const h = setup();
    h.flush();
    pointer(h.canvas, "pointermove", 50, 50);
    pointer(h.canvas, "pointermove", 60, 60);
    expect(h.options.onHover).toHaveBeenCalledTimes(1);
    h.controller.destroy();
  });

  it("treats a press and release without movement as a pick, on the hit or on empty space", () => {
    const h = setup();
    h.flush();
    pointer(h.canvas, "pointerdown", 50, 50);
    pointer(h.canvas, "pointerup", 50, 50);
    expect(h.options.onPick).toHaveBeenLastCalledWith("left");
    pointer(h.canvas, "pointerdown", 350, 250);
    pointer(h.canvas, "pointerup", 350, 250);
    expect(h.options.onPick).toHaveBeenLastCalledWith(undefined);
    h.controller.destroy();
  });

  it("pans on a drag, picks nothing, and sets the dragging class meanwhile", () => {
    const h = setup();
    h.flush();
    const before = h.controller.camera;
    pointer(h.canvas, "pointerdown", 50, 50);
    pointer(h.canvas, "pointermove", 80, 70);
    expect(h.canvas.classList.contains("rh-dragging")).toBe(true);
    pointer(h.canvas, "pointerup", 80, 70);
    expect(h.canvas.classList.contains("rh-dragging")).toBe(false);
    expect(h.options.onPick).not.toHaveBeenCalled();
    expect(h.controller.camera.cx).toBeCloseTo(before.cx - 30 / before.scale, 12);
    expect(h.controller.camera.cy).toBeCloseTo(before.cy - 20 / before.scale, 12);
    h.controller.destroy();
  });

  it("ignores a movement under the drag threshold", () => {
    const h = setup();
    h.flush();
    pointer(h.canvas, "pointerdown", 50, 50);
    pointer(h.canvas, "pointermove", 51, 51);
    pointer(h.canvas, "pointerup", 51, 51);
    expect(h.options.onPick).toHaveBeenCalledTimes(1);
    expect(h.controller.camera.cx).toBe(0.5);
    h.controller.destroy();
  });

  it("opens the hit on a double-click", () => {
    const h = setup();
    h.flush();
    pointer(h.canvas, "dblclick", 50, 50);
    expect(h.options.onOpen).toHaveBeenCalledWith("left");
    pointer(h.canvas, "dblclick", 350, 50);
    expect(h.options.onOpen).toHaveBeenCalledTimes(1);
    h.controller.destroy();
  });

  it("clears the hover when the pointer leaves", () => {
    const h = setup();
    h.flush();
    pointer(h.canvas, "pointermove", 50, 50);
    h.canvas.dispatchEvent(new MouseEvent("pointerleave"));
    expect(h.options.onHover).toHaveBeenLastCalledWith(undefined);
    h.controller.destroy();
  });

  it("zooms by pinch about the midpoint and does not pick when the fingers lift", () => {
    const h = setup();
    h.flush();
    pointer(h.canvas, "pointerdown", 150, 150, { pointerId: 1 });
    pointer(h.canvas, "pointerdown", 250, 150, { pointerId: 2 });
    pointer(h.canvas, "pointermove", 100, 150, { pointerId: 1 });
    pointer(h.canvas, "pointermove", 300, 150, { pointerId: 2 });
    expect(h.controller.camera.scale).toBeGreaterThan(300);
    pointer(h.canvas, "pointerup", 100, 150, { pointerId: 1 });
    pointer(h.canvas, "pointerup", 300, 150, { pointerId: 2 });
    expect(h.options.onPick).not.toHaveBeenCalled();
    h.controller.destroy();
  });
});

describe("wheel", () => {
  const wheel = (canvas: HTMLElement, deltaY: number, init: WheelEventInit = {}): WheelEvent => {
    const event = new WheelEvent("wheel", { deltaY, clientX: 10 + 200, clientY: 20 + 150, bubbles: true, cancelable: true, ...init });
    canvas.dispatchEvent(event);
    return event;
  };

  it("leaves the page scrolling until the canvas has been clicked", () => {
    const h = setup();
    h.flush();
    const event = wheel(h.canvas, -200);
    expect(event.defaultPrevented).toBe(false);
    expect(h.controller.camera.scale).toBe(300);
    pointer(h.canvas, "pointerdown", 200, 150);
    pointer(h.canvas, "pointerup", 200, 150);
    expect(h.options.onActive).toHaveBeenCalledWith(true);
    const armed = wheel(h.canvas, -200);
    expect(armed.defaultPrevented).toBe(true);
    expect(h.controller.camera.scale).toBeGreaterThan(300);
    h.controller.destroy();
  });

  it("zooms about the pointer, keeping the world point under it", () => {
    const h = setup();
    h.flush();
    pointer(h.canvas, "pointerdown", 200, 150);
    pointer(h.canvas, "pointerup", 200, 150);
    const before = h.controller.camera;
    wheel(h.canvas, -300, { clientX: 110, clientY: 70 });
    const after = h.controller.camera;
    expect(after.scale).toBeGreaterThan(before.scale);
    const worldAt = (c: Camera): [number, number] => [c.cx + (100 - 200) / c.scale, c.cy + (50 - 150) / c.scale];
    expect(worldAt(after)[0]).toBeCloseTo(worldAt(before)[0], 9);
    expect(worldAt(after)[1]).toBeCloseTo(worldAt(before)[1], 9);
    h.controller.destroy();
  });

  it("zooms on a pinch gesture (ctrl + wheel) without being armed, and always when asked", () => {
    const h = setup();
    expect(wheel(h.canvas, -100, { ctrlKey: true }).defaultPrevented).toBe(true);
    const always = setup({ wheel: "always" });
    expect(wheel(always.canvas, -100).defaultPrevented).toBe(true);
    h.controller.destroy();
    always.controller.destroy();
  });

  it("disarms when the canvas loses focus", () => {
    const h = setup();
    pointer(h.canvas, "pointerdown", 200, 150);
    h.canvas.dispatchEvent(new FocusEvent("blur"));
    expect(h.options.onActive).toHaveBeenLastCalledWith(false);
    expect(wheel(h.canvas, -100).defaultPrevented).toBe(false);
    h.controller.destroy();
  });

  it("never zooms past the limits", () => {
    const h = setup({ limits: { minScale: 100, maxScale: 400 } });
    pointer(h.canvas, "pointerdown", 200, 150);
    wheel(h.canvas, -5000);
    expect(h.controller.camera.scale).toBe(400);
    wheel(h.canvas, 50000);
    expect(h.controller.camera.scale).toBe(100);
    h.controller.destroy();
  });
});

describe("keyboard", () => {
  const key = (canvas: HTMLElement, name: string): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    return event;
  };

  it("zooms with plus and minus, pans with the arrows", () => {
    const h = setup();
    h.flush();
    key(h.canvas, "+");
    expect(h.controller.camera.scale).toBeCloseTo(390, 9);
    key(h.canvas, "-");
    expect(h.controller.camera.scale).toBeCloseTo(300, 9);
    key(h.canvas, "ArrowRight");
    expect(h.controller.camera.cx).toBeGreaterThan(0.5);
    key(h.canvas, "ArrowUp");
    expect(h.controller.camera.cy).toBeLessThan(0.5);
    h.controller.destroy();
  });

  it("lets the screen handle a key first", () => {
    const onKey = vi.fn((event: KeyboardEvent) => event.key === "Escape");
    const h = setup({ onKey });
    expect(key(h.canvas, "Escape").defaultPrevented).toBe(true);
    key(h.canvas, "+");
    expect(onKey).toHaveBeenCalledTimes(2);
    expect(h.controller.camera.scale).toBeGreaterThan(300);
    h.controller.destroy();
  });

  it("ignores other keys without preventing them", () => {
    const h = setup();
    expect(key(h.canvas, "a").defaultPrevented).toBe(false);
    h.controller.destroy();
  });

  it("returns to the fit camera on 0", () => {
    const h = setup();
    h.flush();
    h.controller.setCamera({ cx: 0.1, cy: 0.1, scale: 5000 });
    key(h.canvas, "0");
    h.flush(0);
    h.flush(1000);
    expect(h.controller.camera).toEqual({ cx: 0.5, cy: 0.5, scale: 300 });
    h.controller.destroy();
  });
});

describe("flying", () => {
  it("animates to the target over the duration and lands exactly on it", () => {
    const h = setup();
    h.flush();
    const target: Camera = { cx: 0.2, cy: 0.3, scale: 6000 };
    h.controller.flyTo(target, 400);
    h.flush(0);
    expect(h.controller.camera.scale).toBeCloseTo(300, 6);
    h.flush(200);
    const mid = h.controller.camera.scale;
    expect(mid).toBeGreaterThan(300);
    expect(mid).toBeLessThan(6000);
    h.flush(400);
    expect(h.controller.camera).toEqual(target);
    expect(queue).toHaveLength(0);
    h.controller.destroy();
  });

  it("jumps under reduced motion", () => {
    reduced = true;
    const h = setup();
    h.flush();
    h.controller.flyTo({ cx: 0.2, cy: 0.3, scale: 6000 });
    expect(h.controller.camera).toEqual({ cx: 0.2, cy: 0.3, scale: 6000 });
    expect(h.frames.at(-1)?.reducedMotion).toBe(true);
    h.controller.destroy();
  });

  it("is interrupted by a drag", () => {
    const h = setup();
    h.flush();
    h.controller.flyTo({ cx: 0.2, cy: 0.3, scale: 6000 }, 400);
    pointer(h.canvas, "pointerdown", 50, 50);
    pointer(h.canvas, "pointermove", 90, 90);
    const held = h.controller.camera;
    h.flush(300);
    expect(h.controller.camera).toEqual(held);
    h.controller.destroy();
  });

  it("frames a rectangle", () => {
    reduced = true;
    const h = setup();
    h.controller.frame({ x: 0, y: 0, w: 0.1, h: 0.1 }, 0.5);
    expect(h.controller.camera.scale).toBeCloseTo(1500, 6);
    expect(h.controller.camera.cx).toBeCloseTo(0.05, 12);
    h.controller.destroy();
  });
});

describe("destroy", () => {
  it("stops reacting and cancels a pending frame", () => {
    const h = setup();
    h.controller.destroy();
    h.flush();
    pointer(h.canvas, "pointermove", 50, 50);
    expect(h.frames).toHaveLength(0);
    expect(h.options.onHover).not.toHaveBeenCalled();
  });
});
