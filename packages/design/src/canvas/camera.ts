/**
 * The camera of a pannable, zoomable canvas. Pure functions over plain numbers, so a layout, a test and a canvas all
 * agree on one meaning: the camera looks at the world point (`cx`, `cy`), and `scale` is screen pixels per world unit.
 * The world point sits at the centre of the viewport.
 */

export interface Camera {
  readonly cx: number;
  readonly cy: number;
  readonly scale: number;
}

/** A size in CSS pixels. */
export interface Size {
  readonly w: number;
  readonly h: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ZoomLimits {
  readonly minScale: number;
  readonly maxScale: number;
}

export const DEFAULT_ZOOM_LIMITS: ZoomLimits = { minScale: 0.01, maxScale: 1e8 };

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

export function clampScale(scale: number, limits: ZoomLimits = DEFAULT_ZOOM_LIMITS): number {
  return clamp(scale, limits.minScale, limits.maxScale);
}

export function worldToScreen(camera: Camera, size: Size, x: number, y: number): Point {
  return { x: size.w / 2 + (x - camera.cx) * camera.scale, y: size.h / 2 + (y - camera.cy) * camera.scale };
}

export function screenToWorld(camera: Camera, size: Size, sx: number, sy: number): Point {
  return { x: camera.cx + (sx - size.w / 2) / camera.scale, y: camera.cy + (sy - size.h / 2) / camera.scale };
}

export function rectToScreen(camera: Camera, size: Size, rect: Rect): Rect {
  const origin = worldToScreen(camera, size, rect.x, rect.y);
  return { x: origin.x, y: origin.y, w: rect.w * camera.scale, h: rect.h * camera.scale };
}

/** Zooms by `factor` keeping the world point under the screen point (`sx`, `sy`) where it is. */
export function zoomAbout(
  camera: Camera,
  size: Size,
  sx: number,
  sy: number,
  factor: number,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
): Camera {
  const scale = clampScale(camera.scale * factor, limits);
  const world = screenToWorld(camera, size, sx, sy);
  return { cx: world.x - (sx - size.w / 2) / scale, cy: world.y - (sy - size.h / 2) / scale, scale };
}

/** Moves the view by a drag of (`dx`, `dy`) screen pixels: the content follows the pointer. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { cx: camera.cx - dx / camera.scale, cy: camera.cy - dy / camera.scale, scale: camera.scale };
}

/** The camera that shows `rect` centred, filling `fill` (0 to 1) of the tighter viewport dimension. */
export function frameRect(rect: Rect, size: Size, fill = 0.9, limits: ZoomLimits = DEFAULT_ZOOM_LIMITS): Camera {
  const scale = clampScale(Math.min((size.w * fill) / Math.max(rect.w, 1e-12), (size.h * fill) / Math.max(rect.h, 1e-12)), limits);
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, scale };
}

/** Keeps the camera's centre within `bounds` grown by `slack` of its size on every side, so the content cannot be lost. */
export function clampCenter(camera: Camera, bounds: Rect, slack = 0.25): Camera {
  return {
    cx: clamp(camera.cx, bounds.x - bounds.w * slack, bounds.x + bounds.w * (1 + slack)),
    cy: clamp(camera.cy, bounds.y - bounds.h * slack, bounds.y + bounds.h * (1 + slack)),
    scale: camera.scale,
  };
}

export function easeInOutCubic(u: number): number {
  const t = clamp(u, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * The camera `u` (0 to 1) of the way from `a` to `b`. The zoom is interpolated in log space and the centre in
 * inverse-scale space, which keeps the destination at a steady speed on screen however many orders of magnitude the
 * zoom crosses; a plain linear blend of the centre would fling the target off screen halfway through a deep zoom.
 */
export function lerpCamera(a: Camera, b: Camera, u: number): Camera {
  const t = clamp(u, 0, 1);
  if (t === 0) return a;
  if (t === 1) return b;
  if (a.scale === b.scale) return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t, scale: a.scale };
  const scale = Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * t);
  const span = 1 / b.scale - 1 / a.scale;
  const along = Math.abs(span) < 1e-15 ? t : (1 / scale - 1 / a.scale) / span;
  return { cx: a.cx + (b.cx - a.cx) * along, cy: a.cy + (b.cy - a.cy) * along, scale };
}

export function sameCamera(a: Camera, b: Camera): boolean {
  return a.cx === b.cx && a.cy === b.cy && a.scale === b.scale;
}
