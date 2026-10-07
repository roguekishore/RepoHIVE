import { describe, expect, it } from "vitest";
import {
  clampCenter,
  clampScale,
  easeInOutCubic,
  frameRect,
  lerpCamera,
  panBy,
  rectToScreen,
  screenToWorld,
  worldToScreen,
  zoomAbout,
  type Camera,
} from "./camera";

const size = { w: 800, h: 600 };
const cam: Camera = { cx: 0.5, cy: 0.5, scale: 400 };

describe("camera", () => {
  it("puts the camera centre at the middle of the viewport and round-trips", () => {
    expect(worldToScreen(cam, size, 0.5, 0.5)).toEqual({ x: 400, y: 300 });
    const screen = worldToScreen(cam, size, 0.25, 0.9);
    const back = screenToWorld(cam, size, screen.x, screen.y);
    expect(back.x).toBeCloseTo(0.25, 12);
    expect(back.y).toBeCloseTo(0.9, 12);
  });

  it("converts a rectangle with the scale", () => {
    expect(rectToScreen(cam, size, { x: 0, y: 0, w: 1, h: 0.5 })).toEqual({ x: 200, y: 100, w: 400, h: 200 });
  });

  it("zooms about a screen point and leaves the world point under it where it was", () => {
    const before = screenToWorld(cam, size, 650, 120);
    const zoomed = zoomAbout(cam, size, 650, 120, 3);
    expect(zoomed.scale).toBe(1200);
    const after = screenToWorld(zoomed, size, 650, 120);
    expect(after.x).toBeCloseTo(before.x, 12);
    expect(after.y).toBeCloseTo(before.y, 12);
  });

  it("clamps the zoom to the limits", () => {
    expect(clampScale(1e12)).toBe(1e8);
    expect(zoomAbout(cam, size, 0, 0, 1e-9, { minScale: 5, maxScale: 10 }).scale).toBe(5);
  });

  it("pans so the content follows the pointer", () => {
    const moved = panBy(cam, 40, -20);
    expect(worldToScreen(moved, size, 0.5, 0.5)).toEqual({ x: 440, y: 280 });
  });

  it("frames a rectangle centred, filling the tighter dimension", () => {
    const framed = frameRect({ x: 2, y: 4, w: 2, h: 1 }, size, 0.5);
    expect(framed.cx).toBe(3);
    expect(framed.cy).toBe(4.5);
    expect(framed.scale).toBe(200);
  });

  it("keeps the centre near the bounds", () => {
    const clamped = clampCenter({ cx: 9, cy: -9, scale: 1 }, { x: 0, y: 0, w: 1, h: 1 }, 0.25);
    expect(clamped).toEqual({ cx: 1.25, cy: -0.25, scale: 1 });
  });

  it("eases between 0 and 1 and is symmetric", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1, 12);
  });

  it("interpolates between its end points", () => {
    const a: Camera = { cx: 0.5, cy: 0.5, scale: 400 };
    const b: Camera = { cx: 0.3, cy: 0.7, scale: 4e6 };
    expect(lerpCamera(a, b, 0)).toEqual(a);
    const end = lerpCamera(a, b, 1);
    expect(end.cx).toBeCloseTo(b.cx, 9);
    expect(end.cy).toBeCloseTo(b.cy, 9);
    expect(end.scale).toBeCloseTo(b.scale, 3);
  });

  it("keeps the destination on screen all through a deep zoom", () => {
    const a: Camera = { cx: 0.5, cy: 0.5, scale: 400 };
    const b: Camera = { cx: 0.3, cy: 0.7, scale: 4e6 };
    const start = worldToScreen(a, size, b.cx, b.cy);
    const startDistance = Math.hypot(start.x - 400, start.y - 300);
    for (let step = 0; step <= 20; step++) {
      const at = lerpCamera(a, b, step / 20);
      const target = worldToScreen(at, size, b.cx, b.cy);
      // Its distance from the centre only shrinks, from where the first frame has it.
      expect(Math.hypot(target.x - 400, target.y - 300)).toBeLessThanOrEqual(startDistance + 1e-6);
    }
  });

  it("interpolates a pure pan linearly", () => {
    const mid = lerpCamera({ cx: 0, cy: 0, scale: 10 }, { cx: 4, cy: 2, scale: 10 }, 0.5);
    expect(mid).toEqual({ cx: 2, cy: 1, scale: 10 });
  });
});
