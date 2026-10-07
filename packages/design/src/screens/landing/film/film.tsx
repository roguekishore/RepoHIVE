"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { useCanvasPalette } from "../../../canvas/use-canvas-palette";
import type { LandingFigures } from "../figures-types";
import { filmColors, filmFonts } from "./film-colors";
import { drawFilm, type FilmOptions } from "./film-draw";
import { buildScene, type FilmScene } from "./film-scene";

const scenes = new WeakMap<LandingFigures, FilmScene>();
/** The scene for a set of figures, built once (it holds a seeded layout of a few hundred files). */
export function sceneFor(figures: LandingFigures): FilmScene {
  let scene = scenes.get(figures);
  if (scene === undefined) {
    scene = buildScene(figures);
    scenes.set(figures, scene);
  }
  return scene;
}

export interface FilmHandle {
  /** Paints the frame at `t` seconds. The film is a pure function of time: this is the whole player contract. */
  paint(t: number): void;
}

export interface FilmCanvasProps extends FilmOptions {
  readonly figures: LandingFigures;
  /** The frame shown first, and again after a resize or a theme change until `paint` is called. */
  readonly initialTime?: number;
  readonly ref?: Ref<FilmHandle>;
}

/**
 * One canvas that shows a frame of the film. It owns no clock: whoever plays the film calls `paint(t)`. It fills its
 * parent, redraws when the parent is resized, and repaints in the new colours when the theme changes.
 */
export function FilmCanvas({ figures, core, initialTime = 0, ref }: FilmCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timeRef = useRef(initialTime);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const palette = useCanvasPalette();
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const coreRef = useRef(core);
  coreRef.current = core;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const pal = paletteRef.current;
    const { w, h, dpr } = sizeRef.current;
    if (canvas === null || pal === undefined || w === 0 || h === 0) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    drawFilm(ctx, sceneFor(figures), timeRef.current, w, h, dpr, filmColors(pal), filmFonts(pal), { core: coreRef.current });
  }, [figures]);

  useImperativeHandle(
    ref,
    () => ({
      paint(t: number) {
        timeRef.current = t;
        draw();
      },
    }),
    [draw],
  );

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      draw();
    };
    resize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  // A new palette (theme change, fonts arriving) repaints the frame on screen.
  useEffect(() => {
    draw();
  }, [palette, draw]);

  return <canvas ref={canvasRef} className="rh-ld-canvas" aria-hidden="true" />;
}
