/**
 * The behaviour every canvas view shares, with no framework in it: it sizes the canvas to its box and to the device
 * pixel ratio, repaints on request (one frame at a time), pans by dragging, zooms by wheel, keys and pinch, flies the
 * camera to a target, tells hovers from clicks, and asks the hit index what is under the pointer. A screen supplies a
 * `draw` function and reacts to what it is told; it never touches a pointer event.
 *
 * A canvas gets the classes `rh-over` (the pointer is over a hit) and `rh-dragging` (a drag is panning), which
 * `styles/frame.css` turns into cursors.
 */
import {
  DEFAULT_ZOOM_LIMITS,
  easeInOutCubic,
  frameRect,
  lerpCamera,
  panBy,
  rectToScreen,
  sameCamera,
  zoomAbout,
  type Camera,
  type Rect,
  type Size,
  type ZoomLimits,
} from "./camera";
import { rgbaCss, type CanvasPalette } from "./colors";
import { HitIndex } from "./hit";
import type { TextSizes } from "./text";

/** What a draw pass is given. Everything is in CSS pixels; the context is already scaled for the device. */
export interface DrawFrame<T> {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly camera: Camera;
  readonly palette: CanvasPalette;
  readonly text: TextSizes;
  /** Empty at the start of the pass: register what you paint that can be hovered or clicked, in screen pixels. */
  readonly hits: HitIndex<T>;
  readonly reducedMotion: boolean;
  /** A world rectangle in screen pixels under the current camera. */
  toScreen(rect: Rect): Rect;
}

export interface CanvasViewOptions<T> {
  /** Paints the whole view. The background is already filled with the `bg` token. */
  draw(frame: DrawFrame<T>): void;
  /** The camera that shows everything, for a viewport of this size. Used first, on resize until the user moves, and by `fit`. */
  fit(size: Size): Camera;
  readonly limits?: ZoomLimits;
  /** Cap on the device pixel ratio, to bound canvas memory. Default 2. */
  readonly maxDpr?: number;
  /**
   * `"focus"` (default): the wheel zooms only after the canvas has been clicked, so the page still scrolls past it;
   * a pinch gesture (ctrl + wheel) always zooms. `"always"`: the wheel always zooms.
   */
  readonly wheel?: "focus" | "always";
  /** The pointer moved over a different hit, or off every hit (`undefined`). Not called during a drag. */
  onHover?(hit: T | undefined): void;
  /** A click or tap that was not a drag: the hit under it, or `undefined` for empty space. */
  onPick?(hit: T | undefined): void;
  /** A double-click on a hit. */
  onOpen?(hit: T): void;
  /** After a repaint in which the camera changed. */
  onCamera?(camera: Camera): void;
  /** The canvas gained or lost focus (the wheel is armed while it has it). */
  onActive?(active: boolean): void;
  /** A key pressed on the focused canvas. Return true when handled: the built-in arrows, plus, minus and 0 then do not run. */
  onKey?(event: KeyboardEvent): boolean;
}

const DRAG_THRESHOLD = 3;
const FLY_MS = 420;
const KEY_PAN = 60;
const KEY_ZOOM = 1.3;
const WHEEL_ZOOM = 0.0016;

interface PointerState {
  x: number;
  y: number;
}

export class CanvasController<T> {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly hits = new HitIndex<T>();
  private appearance: { palette: CanvasPalette; text: TextSizes } | undefined;
  private size: Size = { w: 0, h: 0 };
  private dpr = 1;
  private cam: Camera = { cx: 0, cy: 0, scale: 1 };
  private haveCamera = false;
  private moved = false;
  private lastDrawn: Camera | undefined;
  private frameId = 0;
  private flight = 0;
  private active = false;
  private hovered: T | undefined;
  private destroyed = false;

  private readonly pointers = new Map<number, PointerState>();
  private drag: { x: number; y: number; camera: Camera; moved: boolean } | undefined;
  private pinch: { distance: number } | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private readonly cleanups: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: () => CanvasViewOptions<T>,
  ) {
    this.ctx = canvas.getContext("2d");
    this.listen();
    this.measure();
  }

  /** The current camera. */
  get camera(): Camera {
    return this.cam;
  }

  /** The canvas box in CSS pixels. */
  get viewport(): Size {
    return this.size;
  }

  /** Palette and text sizes arrive (and change with the theme): the next frame is drawn with them. */
  setAppearance(palette: CanvasPalette, text: TextSizes): void {
    this.appearance = { palette, text };
    this.invalidate();
  }

  /** Asks for one repaint on the next animation frame; any number of calls before it share the one frame. */
  invalidate(): void {
    if (this.frameId !== 0 || this.destroyed) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = 0;
      this.paint();
    });
  }

  /** Jumps to a camera. The user is taken to have moved it, so a resize no longer re-fits. */
  setCamera(camera: Camera): void {
    this.cancelFlight();
    this.cam = this.limit(camera);
    this.haveCamera = true;
    this.moved = true;
    this.invalidate();
  }

  /** Flies to a camera (a jump under reduced motion). */
  flyTo(target: Camera, duration = FLY_MS): void {
    const goal = this.limit(target);
    this.cancelFlight();
    this.moved = true;
    this.haveCamera = true;
    if (this.reducedMotion() || duration <= 0) {
      this.cam = goal;
      this.invalidate();
      return;
    }
    const from = this.cam;
    const begin = performance.now();
    const step = (now: number): void => {
      if (this.destroyed) return;
      const u = Math.min(1, (now - begin) / duration);
      this.cam = u >= 1 ? goal : lerpCamera(from, goal, easeInOutCubic(u));
      this.paint();
      this.flight = u < 1 ? requestAnimationFrame(step) : 0;
    };
    this.flight = requestAnimationFrame(step);
  }

  /** Zooms about the centre of the view. */
  zoomBy(factor: number): void {
    this.flyTo({ ...this.cam, scale: this.cam.scale * factor });
  }

  /** Back to the camera `fit` gives, and re-fits on resize again. */
  fit(): void {
    this.flyTo(this.options().fit(this.size));
    this.moved = false;
  }

  /** Frames a world rectangle. */
  frame(rect: Rect, fill = 0.86): void {
    this.flyTo(frameRect(rect, this.size, fill, this.limits()));
  }

  /** Stops listening and cancels any pending frame. */
  destroy(): void {
    this.destroyed = true;
    this.cancelFlight();
    if (this.frameId !== 0) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.resizeObserver?.disconnect();
    for (const undo of this.cleanups) undo();
    this.cleanups.length = 0;
  }

  private limits(): ZoomLimits {
    return this.options().limits ?? DEFAULT_ZOOM_LIMITS;
  }

  private limit(camera: Camera): Camera {
    const { minScale, maxScale } = this.limits();
    return { ...camera, scale: Math.min(maxScale, Math.max(minScale, camera.scale)) };
  }

  private reducedMotion(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private cancelFlight(): void {
    if (this.flight !== 0) cancelAnimationFrame(this.flight);
    this.flight = 0;
  }

  private on<K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void, passive = true): void {
    this.canvas.addEventListener(type, handler, { passive });
    this.cleanups.push(() => this.canvas.removeEventListener(type, handler));
  }

  private listen(): void {
    this.on("pointerdown", (event) => this.onPointerDown(event));
    this.on("pointermove", (event) => this.onPointerMove(event));
    this.on("pointerup", (event) => this.onPointerUp(event));
    this.on("pointercancel", (event) => this.endPointer(event));
    this.on("pointerleave", () => this.setHover(undefined));
    this.on("dblclick", (event) => {
      const point = this.local(event);
      const hit = this.hits.at(point.x, point.y);
      if (hit !== undefined) this.options().onOpen?.(hit);
    });
    this.on("wheel", (event) => this.onWheel(event), false);
    this.on("keydown", (event) => this.onKeyDown(event), false);
    this.on("blur", () => this.setActive(false));

    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => this.measure());
      this.resizeObserver.observe(this.canvas);
    }
    this.watchDpr();
  }

  /** A change of device pixel ratio (a window dragged to another screen) does not resize the box, so it is watched on its own. */
  private watchDpr(): void {
    if (typeof matchMedia !== "function") return;
    const ratio = window.devicePixelRatio || 1;
    const query = matchMedia(`(resolution: ${ratio}dppx)`);
    const changed = (): void => {
      query.removeEventListener("change", changed);
      this.measure();
      this.watchDpr();
    };
    query.addEventListener("change", changed);
    this.cleanups.push(() => query.removeEventListener("change", changed));
  }

  private measure(): void {
    if (this.destroyed) return;
    const box = this.canvas.getBoundingClientRect();
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    if (w < 1 || h < 1) return;
    const dpr = Math.min(this.options().maxDpr ?? 2, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(w * dpr);
    const pixelHeight = Math.round(h * dpr);
    if (w === this.size.w && h === this.size.h && dpr === this.dpr && this.canvas.width === pixelWidth) return;
    this.size = { w, h };
    this.dpr = dpr;
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    if (!this.haveCamera || !this.moved) {
      this.cam = this.limit(this.options().fit(this.size));
      this.haveCamera = true;
    }
    this.invalidate();
  }

  private paint(): void {
    const ctx = this.ctx;
    const look = this.appearance;
    if (this.destroyed || ctx === null || look === undefined || this.size.w < 1) return;
    const { palette, text } = look;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.fillStyle = rgbaCss(palette.colors.bg);
    ctx.fillRect(0, 0, this.size.w, this.size.h);
    this.hits.clear();
    const camera = this.cam;
    const size = this.size;
    this.options().draw({
      ctx,
      width: size.w,
      height: size.h,
      dpr: this.dpr,
      camera,
      palette,
      text,
      hits: this.hits,
      reducedMotion: this.reducedMotion(),
      toScreen: (rect) => rectToScreen(camera, size, rect),
    });
    if (this.lastDrawn === undefined || !sameCamera(this.lastDrawn, camera)) {
      this.lastDrawn = camera;
      this.options().onCamera?.(camera);
    }
  }

  private local(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const box = this.canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  private setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.options().onActive?.(active);
  }

  private setHover(hit: T | undefined): void {
    this.canvas.classList.toggle("rh-over", hit !== undefined);
    if (hit === this.hovered) return;
    this.hovered = hit;
    this.options().onHover?.(hit);
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== undefined && event.button !== 0) return;
    this.setActive(true);
    this.canvas.focus({ preventScroll: true });
    const point = this.local(event);
    const id = event.pointerId ?? 1;
    this.pointers.set(id, point);
    try {
      this.canvas.setPointerCapture?.(id);
    } catch {
      // A pointer that is already gone cannot be captured; the drag simply does not start.
    }
    if (this.pointers.size === 2) {
      this.pinch = { distance: this.pinchDistance() };
      this.drag = undefined;
      return;
    }
    this.drag = { x: point.x, y: point.y, camera: this.cam, moved: false };
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a === undefined || b === undefined ? 0 : Math.hypot(a.x - b.x, a.y - b.y);
  }

  private onPointerMove(event: PointerEvent): void {
    const point = this.local(event);
    const id = event.pointerId ?? 1;
    if (this.pointers.has(id)) this.pointers.set(id, point);

    if (this.pinch !== undefined && this.pointers.size >= 2) {
      const distance = this.pinchDistance();
      const [a, b] = [...this.pointers.values()];
      if (this.pinch.distance > 0 && distance > 0 && a !== undefined && b !== undefined) {
        this.cancelFlight();
        this.moved = true;
        this.cam = zoomAbout(this.cam, this.size, (a.x + b.x) / 2, (a.y + b.y) / 2, distance / this.pinch.distance, this.limits());
        this.invalidate();
      }
      this.pinch = { distance };
      return;
    }

    if (this.drag !== undefined) {
      const dx = point.x - this.drag.x;
      const dy = point.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        this.drag.moved = true;
        this.canvas.classList.add("rh-dragging");
        this.setHover(undefined);
      }
      if (this.drag.moved) {
        this.cancelFlight();
        this.moved = true;
        this.cam = panBy(this.drag.camera, dx, dy);
        this.invalidate();
      }
      return;
    }
    this.setHover(this.hits.at(point.x, point.y));
  }

  private onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    const wasPinch = this.pinch !== undefined;
    const point = this.local(event);
    this.endPointer(event);
    if (drag !== undefined && !drag.moved && !wasPinch) this.options().onPick?.(this.hits.at(point.x, point.y));
  }

  private endPointer(event: PointerEvent): void {
    this.pointers.delete(event.pointerId ?? 1);
    if (this.pointers.size < 2) this.pinch = undefined;
    if (this.pointers.size === 0) {
      this.drag = undefined;
      this.canvas.classList.remove("rh-dragging");
    } else if (this.pointers.size === 1) {
      // The pinch ended with one finger still down: it must not turn into a click or a jump when it lifts.
      this.drag = undefined;
    }
  }

  private onWheel(event: WheelEvent): void {
    if (this.options().wheel !== "always" && !this.active && !event.ctrlKey) return;
    event.preventDefault();
    this.cancelFlight();
    this.moved = true;
    const point = this.local(event);
    const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    this.cam = zoomAbout(this.cam, this.size, point.x, point.y, Math.exp(-dy * WHEEL_ZOOM), this.limits());
    this.invalidate();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.options().onKey?.(event) === true) {
      event.preventDefault();
      return;
    }
    const cam = this.cam;
    const half = { x: this.size.w / 2, y: this.size.h / 2 };
    switch (event.key) {
      case "+":
      case "=":
        this.cam = zoomAbout(cam, this.size, half.x, half.y, KEY_ZOOM, this.limits());
        break;
      case "-":
      case "_":
        this.cam = zoomAbout(cam, this.size, half.x, half.y, 1 / KEY_ZOOM, this.limits());
        break;
      case "0":
        event.preventDefault();
        this.fit();
        return;
      case "ArrowLeft":
        this.cam = panBy(cam, KEY_PAN, 0);
        break;
      case "ArrowRight":
        this.cam = panBy(cam, -KEY_PAN, 0);
        break;
      case "ArrowUp":
        this.cam = panBy(cam, 0, KEY_PAN);
        break;
      case "ArrowDown":
        this.cam = panBy(cam, 0, -KEY_PAN);
        break;
      default:
        return;
    }
    event.preventDefault();
    this.cancelFlight();
    this.moved = true;
    this.invalidate();
  }
}
