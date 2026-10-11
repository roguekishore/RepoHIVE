import { describe, expect, it } from "vitest";
import { readPalette } from "../../../canvas/colors";
import { BROADLEAF_FIGURES as F } from "../broadleaf-figures";
import { filmColors, filmFonts } from "./film-colors";
import { drawFilm, wrapTime } from "./film-draw";
import { CHAPTERS, LOOP, STILL, buildScene } from "./film-scene";

/** A canvas that records every call and every property it is given, so two frames can be compared exactly. */
function recorder(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get: (target, key: string) => {
      if (key === "measureText") return (text: string) => ({ width: text.length * 6 });
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        log.push(`${key}(${args.map((arg) => (typeof arg === "number" ? arg.toFixed(3) : String(arg))).join(",")})`);
        return key === "createLinearGradient" || key === "createRadialGradient" ? { addColorStop: () => undefined } : undefined;
      };
    },
    set: (target, key: string, value: unknown) => {
      target[key] = value;
      log.push(`${key}=${String(value)}`);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

const palette = readPalette({ computedColor: (token) => (token === "surface" ? "rgb(250 250 250)" : "rgb(40 60 40)"), computedFont: () => "sans" });
const scene = buildScene(F);

function frame(t: number): string[] {
  const { ctx, log } = recorder();
  drawFilm(ctx, scene, t, 1600, 1000, 1, filmColors(palette), filmFonts(palette));
  return log;
}

describe("the film", () => {
  it("is a pure function of time: the same time paints the same frame, every time", () => {
    expect(frame(13.37)).toEqual(frame(13.37));
    expect(frame(STILL)).toEqual(frame(STILL));
  });

  it("does not depend on what was painted before", () => {
    const direct = frame(22.5);
    frame(3);
    frame(30);
    expect(frame(22.5)).toEqual(direct);
  });

  it("changes as time passes, and paints something in every chapter", () => {
    const first = frame(1);
    expect(frame(9)).not.toEqual(first);
    for (const chapter of CHAPTERS) {
      const middle = (chapter.range[0] + Math.min(chapter.range[1], LOOP)) / 2;
      expect(frame(middle).length, chapter.label).toBeGreaterThan(20);
    }
  });

  it("builds the same scene from the same figures", () => {
    const a = buildScene(F);
    const b = buildScene(F);
    expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
  });

  it("wraps time into one loop", () => {
    expect(wrapTime(LOOP + 2)).toBeCloseTo(2, 9);
    expect(wrapTime(-1)).toBeCloseTo(LOOP - 1, 9);
    expect(CHAPTERS[0]?.range[0]).toBe(0);
    expect(CHAPTERS[CHAPTERS.length - 1]?.range[1]).toBe(LOOP);
  });

  it("paints no colour, font or size of its own: it uses the palette it was given", () => {
    const styles = frame(STILL).filter((entry) => /^(fillStyle|strokeStyle|font)=/.test(entry));
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.every((entry) => entry.startsWith("font=") || /rgba?\(/.test(entry))).toBe(true);
  });
});
