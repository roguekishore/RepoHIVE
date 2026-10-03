"use client";

/**
 * React host for the circle graph. Owns the `<canvas>`, a dirty-flag render
 * loop and the interaction layer: wheel-zoom, drag-pan, keyboard, hover,
 * click to select (which reveals that circle's links), double-click to fly
 * into a circle or, on empty space, out of the current one.
 *
 * Camera math is the structure map's centre-anchored camera, with a far larger
 * zoom ceiling: circles nest several times smaller per level, so the deepest
 * file sits thousands of times below the root.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  type Camera,
  type Viewport,
  flyDuration,
  interpolateCamera,
  panByScreen,
  resolveZoomPalette,
  screenToWorld,
  type ZoomPalette,
} from "@/features/structure-map/canvas";
import { useThemeVersion } from "@/lib/theme-tokens";
import { type EndpointCounts, type Hit, drawCircles, pickHit } from "./draw";
import { type CircleModel, type CircleNode, type SelectionLinks, linksOf } from "./model";

export interface CircleCanvasHandle {
  flyTo: (id: string) => void;
  reset: () => void;
}

interface CircleCanvasProps {
  model: CircleModel;
  selectedId: string | null;
  onSelect: (node: CircleNode | null) => void;
  /** Root-first circle ids the camera is inside, on change. */
  onFocusChange: (path: string[]) => void;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 1e9;
const WHEEL_ZOOM_RATE = 0.0025;
const KEY_PAN_PX = 80;
const KEY_ZOOM_FACTOR = 1.45;
const CLICK_SLOP_PX = 4;
const FRAME_FILL = 0.8;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

function zoomAbout(cam: Camera, vp: Viewport, sx: number, sy: number, factor: number): Camera {
  const anchor = screenToWorld(cam, vp, sx, sy);
  const scale = clampScale(cam.scale * factor);
  return { cx: anchor.wx - (sx - vp.w / 2) / scale, cy: anchor.wy - (sy - vp.h / 2) / scale, scale };
}

function clampCentre(cam: Camera): Camera {
  return {
    cx: Math.min(1.25, Math.max(-0.25, cam.cx)),
    cy: Math.min(1.25, Math.max(-0.25, cam.cy)),
    scale: clampScale(cam.scale),
  };
}

function frameCircle(vp: Viewport, n: { x: number; y: number; r: number }): Camera {
  return { cx: n.x, cy: n.y, scale: clampScale((Math.min(vp.w, vp.h) * FRAME_FILL) / (2 * n.r)) };
}

interface Tween {
  from: Camera;
  to: Camera;
  start: number;
  dur: number;
}

class CircleRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  cam: Camera = { cx: 0.5, cy: 0.5, scale: 600 };
  vp: Viewport = { w: 1, h: 1 };
  hits: Hit[] = [];
  endpoints: Map<string, EndpointCounts> = new Map();
  /** Root-first circle ids the camera is inside, as of the last frame. */
  focusPath: string[] = [];
  model: CircleModel | null = null;
  palette: ZoomPalette;
  hoveredId: string | null = null;
  selectedId: string | null = null;
  selectionLinks: SelectionLinks | null = null;
  private paths = new Map<string, CircleNode[]>();
  private dpr = 1;
  private framed = false;
  private tween: Tween | null = null;
  private raf: number | null = null;
  private lowDetail = 0;
  private lastFocus = "";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onFocus: (path: string[]) => void,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("CircleRenderer: 2D canvas context unavailable");
    this.ctx = ctx;
    this.palette = resolveZoomPalette();
    this.resize();
  }

  fit(): Camera {
    return { cx: 0.5, cy: 0.5, scale: clampScale(Math.min(this.vp.w, this.vp.h) * 0.9) };
  }

  setModel(model: CircleModel): void {
    this.model = model;
    this.paths = new Map();
    if (!this.framed && this.vp.w > 1) {
      this.cam = this.fit();
      this.framed = true;
    }
    this.invalidate();
  }

  setCamera(cam: Camera): void {
    this.tween = null;
    this.cam = cam;
    this.invalidate();
  }

  animateTo(to: Camera, reduced: boolean): void {
    if (reduced) {
      this.setCamera(to);
      return;
    }
    this.tween = { from: this.cam, to, start: performance.now(), dur: flyDuration(this.cam, to, 320, 900) };
    this.invalidate();
  }

  flyTo(id: string, reduced: boolean): void {
    const n = this.model?.nodes.get(id);
    if (n) this.animateTo(frameCircle(this.vp, n), reduced);
  }

  markPan(): void {
    this.lowDetail = 2;
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.dpr = window.devicePixelRatio || 1;
    this.vp = { w, h };
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    if (this.model && !this.framed && w > 1) {
      this.cam = this.fit();
      this.framed = true;
    }
    this.invalidate();
  }

  invalidate(): void {
    if (this.raf === null) this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  private readonly frame = (): void => {
    this.raf = null;
    let animating = false;
    if (this.tween) {
      const t = (performance.now() - this.tween.start) / this.tween.dur;
      if (t >= 1) {
        this.cam = this.tween.to;
        this.tween = null;
      } else {
        this.cam = interpolateCamera(this.tween.from, this.tween.to, t);
        animating = true;
      }
    }
    if (!this.model) return;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const result = drawCircles(
      this.ctx,
      this.model,
      this.cam,
      this.vp,
      this.palette,
      {
        hoveredId: this.hoveredId,
        selectedId: this.selectedId,
        selectionLinks: this.selectionLinks,
        lowDetail: this.lowDetail > 0,
      },
      this.paths,
    );
    this.hits = result.hits;
    this.endpoints = result.endpoints;
    const key = result.focusPath.join("/");
    if (key !== this.lastFocus) {
      this.lastFocus = key;
      this.focusPath = result.focusPath;
      this.onFocus(result.focusPath);
    }
    if (this.lowDetail > 0) this.lowDetail--;
    if (animating || this.lowDetail > 0) this.invalidate();
  };
}

interface HoverState {
  node: CircleNode;
  sx: number;
  sy: number;
  /** Links between the selection and this circle, when it is one of the selection's link ends. */
  link: EndpointCounts | null;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export const CircleCanvas = forwardRef<CircleCanvasHandle, CircleCanvasProps>(function CircleCanvas(
  { model, selectedId, onSelect, onFocusChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CircleRenderer | null>(null);
  const themeVersion = useThemeVersion();
  const reduced = usePrefersReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onFocusRef = useRef(onFocusChange);
  onFocusRef.current = onFocusChange;
  const [hover, setHover] = useState<HoverState | null>(null);

  const selectionLinks = useMemo(() => (selectedId ? linksOf(model, selectedId) : null), [model, selectedId]);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (id) => rendererRef.current?.flyTo(id, reducedRef.current),
      reset: () => {
        const r = rendererRef.current;
        if (r) r.animateTo(r.fit(), reducedRef.current);
      },
    }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new CircleRenderer(canvas, (path) => onFocusRef.current(path));
    rendererRef.current = renderer;
    const obs = new ResizeObserver(() => renderer.resize());
    obs.observe(canvas);
    return () => {
      obs.disconnect();
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setModel(model);
  }, [model]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.selectedId = selectedId;
    r.selectionLinks = selectionLinks;
    r.invalidate();
  }, [selectedId, selectionLinks]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.palette = resolveZoomPalette();
    r.invalidate();
  }, [themeVersion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const local = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    };
    let dragging = false;
    let moved = 0;
    let last = { x: 0, y: 0 };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = rendererRef.current;
      if (!r) return;
      const { sx, sy } = local(e);
      r.setCamera(clampCentre(zoomAbout(r.cam, r.vp, sx, sy, Math.exp(-e.deltaY * WHEEL_ZOOM_RATE))));
      setHover(null);
    };

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      last = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      if (dragging) {
        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        moved += Math.abs(dx) + Math.abs(dy);
        last = { x: e.clientX, y: e.clientY };
        if (moved > CLICK_SLOP_PX) {
          canvas.style.cursor = "grabbing";
          r.setCamera(clampCentre(panByScreen(r.cam, dx, dy)));
          r.markPan();
          setHover(null);
        }
        return;
      }
      const { sx, sy } = local(e);
      const id = pickHit(r.hits, sx, sy);
      if (id !== r.hoveredId) {
        r.hoveredId = id;
        r.invalidate();
      }
      const node = id ? model.nodes.get(id) : undefined;
      setHover(node ? { node, sx, sy, link: r.endpoints.get(node.id) ?? null } : null);
      canvas.style.cursor = node ? "pointer" : "grab";
    };

    const onPointerUp = (e: PointerEvent) => {
      const r = rendererRef.current;
      if (r && dragging && moved <= CLICK_SLOP_PX) {
        const { sx, sy } = local(e);
        const id = pickHit(r.hits, sx, sy);
        // Clicking the root (the background circle) clears the selection like empty space does.
        const node = id && id !== model.rootId ? (model.nodes.get(id) ?? null) : null;
        onSelectRef.current(node);
      }
      dragging = false;
      canvas.style.cursor = "grab";
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };

    const onPointerLeave = () => {
      const r = rendererRef.current;
      if (r?.hoveredId) {
        r.hoveredId = null;
        r.invalidate();
      }
      setHover(null);
    };

    const zoomOut = () => {
      const r = rendererRef.current;
      if (!r) return;
      const path = r.focusPath;
      const up = path.length >= 2 ? path[path.length - 2]! : model.rootId;
      if (up === model.rootId) r.animateTo(r.fit(), reducedRef.current);
      else r.flyTo(up, reducedRef.current);
    };

    // Double-click a circle to fly into it; on empty space, fly out one level.
    const onDoubleClick = (e: MouseEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      const { sx, sy } = local(e);
      const id = pickHit(r.hits, sx, sy);
      const focus = r.focusPath[r.focusPath.length - 1];
      if (id && id !== focus) r.flyTo(id, reducedRef.current);
      else zoomOut();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      const { cam, vp } = r;
      switch (e.key) {
        case "ArrowLeft":
          r.setCamera(clampCentre(panByScreen(cam, KEY_PAN_PX, 0)));
          break;
        case "ArrowRight":
          r.setCamera(clampCentre(panByScreen(cam, -KEY_PAN_PX, 0)));
          break;
        case "ArrowUp":
          r.setCamera(clampCentre(panByScreen(cam, 0, KEY_PAN_PX)));
          break;
        case "ArrowDown":
          r.setCamera(clampCentre(panByScreen(cam, 0, -KEY_PAN_PX)));
          break;
        case "+":
        case "=":
          r.setCamera(clampCentre(zoomAbout(cam, vp, vp.w / 2, vp.h / 2, KEY_ZOOM_FACTOR)));
          break;
        case "-":
        case "_":
          r.setCamera(clampCentre(zoomAbout(cam, vp, vp.w / 2, vp.h / 2, 1 / KEY_ZOOM_FACTOR)));
          break;
        case "Backspace":
          zoomOut();
          break;
        case "Escape":
          onSelectRef.current(null);
          return;
        default:
          return;
      }
      e.preventDefault();
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("keydown", onKeyDown);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("keydown", onKeyDown);
    };
  }, [model]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-label="Circle graph. Scroll to zoom, drag to pan, click a circle to show its links, double-click a circle to fly into it and empty space to fly out, Backspace to go up a level, Escape to clear the selection."
        className="h-full w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
        style={{ cursor: "grab" }}
      />
      {hover && <HoverCard hover={hover} canvas={canvasRef.current} />}
    </div>
  );
});

function HoverCard({ hover, canvas }: { hover: HoverState; canvas: HTMLCanvasElement | null }) {
  const w = canvas?.clientWidth ?? 0;
  const h = canvas?.clientHeight ?? 0;
  const tx = w > 0 && hover.sx > w * 0.66 ? "calc(-100% - 14px)" : "14px";
  const ty = h > 0 && hover.sy > h * 0.66 ? "calc(-100% - 14px)" : "14px";
  const { node, link } = hover;
  const files = node.node.metrics.file_count;
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-[18rem] rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs shadow-xl"
      style={{ left: hover.sx, top: hover.sy, transform: `translate(${tx}, ${ty})` }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
        {node.node.kind}
        {node.chain.length > 1 ? ` · ${node.chain.length} levels merged` : ""}
      </div>
      <div className="mt-0.5 break-words font-semibold text-[var(--color-text-primary)]">{node.label}</div>
      <div className="mt-1 tabular-nums text-[var(--color-text-secondary)]">
        {files} file{files === 1 ? "" : "s"}
        {node.children.length > 0 ? ` · ${node.children.length} inside` : ""}
      </div>
      {link && (
        <div className="mt-1.5 border-t border-[var(--color-border-default)] pt-1.5 tabular-nums text-[var(--color-text-secondary)]">
          {link.out > 0 && <div className="text-[var(--color-accent-primary)]">Selection depends on this · {link.out}</div>}
          {link.in > 0 && <div className="text-[var(--color-accent-secondary)]">This depends on the selection · {link.in}</div>}
        </div>
      )}
    </div>
  );
}
