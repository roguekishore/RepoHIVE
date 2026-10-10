"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Camera, Rect } from "./camera";
import type { ColorSource } from "./colors";
import { CanvasController, type CanvasViewOptions } from "./controller";
import { readTextSizes } from "./text";
import { useCanvasPalette } from "./use-canvas-palette";

export interface CanvasView {
  /** Put this on the `<canvas>` (give it `tabIndex={0}` and an `aria-label`). */
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Call when something the draw function reads changed (hover, selection, data). Calls in one frame share one repaint. */
  invalidate(): void;
  flyTo(camera: Camera): void;
  setCamera(camera: Camera): void;
  zoomBy(factor: number): void;
  fit(): void;
  /** Frames a world rectangle. */
  frame(rect: Rect, fill?: number): void;
  /** The current camera, or `undefined` before the canvas has mounted. */
  camera(): Camera | undefined;
}

/**
 * Runs a {@link CanvasController} on a canvas for as long as the component is mounted. The latest `options` are always
 * used (no need to memoise them), the canvas repaints when the theme or fonts change, and nothing is drawn until the
 * palette has been read, so a server render and the first client render match. `colors` is for tests.
 */
export function useCanvasView<T>(options: CanvasViewOptions<T>, colors?: ColorSource): CanvasView {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controller = useRef<CanvasController<T> | null>(null);
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  // Counts controller creations (twice under StrictMode), so the palette effect below runs for each new controller.
  const [mounted, setMounted] = useState(0);
  const palette = useCanvasPalette(colors);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const created = new CanvasController<T>(canvas, () => latest.current);
    controller.current = created;
    setMounted((n) => n + 1);
    return () => {
      created.destroy();
      controller.current = null;
    };
  }, []);

  useEffect(() => {
    if (palette === undefined || mounted === 0) return;
    controller.current?.setAppearance(palette, readTextSizes(document.documentElement));
  }, [palette, mounted]);

  const invalidate = useCallback(() => controller.current?.invalidate(), []);
  const flyTo = useCallback((camera: Camera) => controller.current?.flyTo(camera), []);
  const setCamera = useCallback((camera: Camera) => controller.current?.setCamera(camera), []);
  const zoomBy = useCallback((factor: number) => controller.current?.zoomBy(factor), []);
  const fit = useCallback(() => controller.current?.fit(), []);
  const frame = useCallback((rect: Rect, fill?: number) => controller.current?.frame(rect, fill), []);
  const camera = useCallback(() => controller.current?.camera, []);

  return { canvasRef, invalidate, flyTo, setCamera, zoomBy, fit, frame, camera };
}
