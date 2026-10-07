import { afterEach, describe, expect, it, vi } from "vitest";
import { COLOR_TOKENS, tokenVar } from "../tokens/names";
import { readTokenBlocks, type Declarations } from "../tokens/tokens-css";
import {
  domColorSource,
  luminance,
  mixColors,
  oklabToRgb,
  parseColor,
  readPalette,
  rgbaCss,
  watchPalette,
  type ColorSource,
} from "./colors";

const near = (actual: number, expected: number, tolerance = 1): void => {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
};

/** A source that answers from tokens.css itself, resolving the two neutral variables like a browser would. */
function sourceFor(theme: Declarations, light: Declarations): ColorSource {
  const resolve = (value: string): string =>
    value.replace(/var\((--rh-[a-z-]+)\)/g, (_match, name: string) => theme.get(name) ?? light.get(name) ?? `MISSING:${name}`);
  return {
    computedColor: (token) => resolve(theme.get(tokenVar(token)) ?? light.get(tokenVar(token)) ?? ""),
    computedFont: (token) => resolve(light.get(tokenVar(token)) ?? ""),
  };
}

describe("parseColor", () => {
  it("reads hex in three forms", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#0a141e")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor("#0a141e80")?.a).toBeCloseTo(0.502, 2);
  });

  it("reads rgb in the comma and the space syntax, with alpha", () => {
    expect(parseColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor("rgb(10 20 30 / 25%)")).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
  });

  it("reads color(srgb)", () => {
    const c = parseColor("color(srgb 1 0.5 0)");
    near(c?.r ?? -1, 255);
    near(c?.g ?? -1, 127.5);
    near(c?.b ?? -1, 0);
  });

  it("reads oklch: white, black and a mid grey", () => {
    expect(parseColor("oklch(1 0 0)")).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(parseColor("oklch(0 0 0)")).toMatchObject({ r: 0, g: 0, b: 0 });
    const grey = parseColor("oklch(0.5 0 0)");
    near(grey?.r ?? -1, 99);
    near(grey?.g ?? -1, 99);
    near(grey?.b ?? -1, 99);
  });

  it("matches Ottosson's published OKLab values for sRGB red and green", () => {
    const red = oklabToRgb(0.627955, 0.224863, 0.125846);
    near(red[0], 255);
    near(red[1], 0);
    near(red[2], 0);
    const green = oklabToRgb(0.866440, -0.233888, 0.179498);
    near(green[0], 0);
    near(green[1], 255);
    near(green[2], 0);
  });

  it("reads oklab, and oklch as the same colour in polar form", () => {
    const polar = parseColor("oklch(0.627955 0.2577 29.23)");
    const cartesian = parseColor("oklab(0.627955 0.224863 0.125846)");
    expect(polar).toBeDefined();
    near(polar?.r ?? -1, cartesian?.r ?? -2);
    near(polar?.g ?? -1, cartesian?.g ?? -2);
    near(polar?.b ?? -1, cartesian?.b ?? -2);
  });

  it("reads percentages, units on the hue, none and alpha", () => {
    expect(parseColor("oklch(100% 0 0)")).toMatchObject({ r: 255 });
    near(parseColor("oklch(0.5 0.1 0.5turn)")?.r ?? -1, parseColor("oklch(0.5 0.1 180)")?.r ?? -2);
    expect(parseColor("oklch(0.5 none none)")).toBeDefined();
    expect(parseColor("oklch(0.21 0.008 125 / 0.32)")?.a).toBeCloseTo(0.32, 5);
  });

  it("answers undefined for syntax it does not read", () => {
    expect(parseColor("")).toBeUndefined();
    expect(parseColor("rebeccapurple")).toBeUndefined();
    expect(parseColor("oklch(banana 0 0)")).toBeUndefined();
    expect(parseColor("hsl(10 20% 30%)")).toBeUndefined();
    expect(parseColor("#12")).toBeUndefined();
  });

  it("clips a colour outside sRGB instead of overflowing", () => {
    const c = parseColor("oklch(0.7 0.4 150)");
    for (const channel of [c?.r, c?.g, c?.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });
});

describe("colour helpers", () => {
  it("formats for a canvas", () => {
    expect(rgbaCss({ r: 10.4, g: 20.6, b: 30, a: 1 })).toBe("rgb(10 21 30)");
    expect(rgbaCss({ r: 10, g: 20, b: 30, a: 0.5 })).toBe("rgb(10 20 30 / 0.5)");
    expect(rgbaCss({ r: 10, g: 20, b: 30, a: 0.5 }, 0.5)).toBe("rgb(10 20 30 / 0.25)");
  });

  it("mixes in sRGB and clamps the amount", () => {
    const a = { r: 0, g: 0, b: 0, a: 1 };
    const b = { r: 100, g: 200, b: 50, a: 0 };
    expect(mixColors(a, b, 0.5)).toEqual({ r: 50, g: 100, b: 25, a: 0.5 });
    expect(mixColors(a, b, -1)).toEqual(a);
    expect(mixColors(a, b, 2)).toEqual(b);
  });

  it("orders luminance", () => {
    expect(luminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1, 5);
    expect(luminance({ r: 0, g: 0, b: 0, a: 1 })).toBe(0);
  });
});

describe("readPalette against the real tokens", () => {
  const blocks = readTokenBlocks();

  it("reads every colour token in the light theme", () => {
    const palette = readPalette(sourceFor(blocks.light, blocks.light));
    expect(Object.keys(palette.colors).sort()).toEqual([...COLOR_TOKENS].sort());
    expect(palette.scheme).toBe("light");
    expect(palette.colors.bg.r).toBeGreaterThan(240);
    expect(palette.colors.fg.r).toBeLessThan(60);
    expect(palette.sans).toContain("Host Grotesk");
    expect(palette.mono).toContain("Geist Mono");
  });

  it("reads every colour token in the dark theme, from both dark blocks", () => {
    for (const dark of [blocks.darkOverride, blocks.darkSystem]) {
      const palette = readPalette(sourceFor(dark, blocks.light));
      expect(palette.scheme).toBe("dark");
      expect(palette.colors.bg.r).toBeLessThan(60);
      expect(palette.colors.fg.r).toBeGreaterThan(200);
    }
  });

  it("keeps the scrim translucent and everything else opaque", () => {
    const palette = readPalette(sourceFor(blocks.light, blocks.light));
    expect(palette.colors.scrim.a).toBeCloseTo(0.32, 5);
    for (const token of COLOR_TOKENS.filter((name) => name !== "scrim")) {
      expect(palette.colors[token].a, token).toBe(1);
    }
  });

  it("keeps kept and rebuilt apart in both themes", () => {
    for (const theme of [blocks.light, blocks.darkOverride]) {
      const { colors } = readPalette(sourceFor(theme, blocks.light));
      const gap = Math.abs(colors["fg-2"].r - colors.rebuilt.r) + Math.abs(colors["fg-2"].g - colors.rebuilt.g) + Math.abs(colors["fg-2"].b - colors.rebuilt.b);
      expect(gap).toBeGreaterThan(40);
    }
  });

  it("is deterministic: the same page gives the same palette", () => {
    const source = sourceFor(blocks.light, blocks.light);
    expect(readPalette(source)).toEqual(readPalette(source));
  });

  it("falls back to rasterizing a syntax it cannot parse, and fails clearly without one", () => {
    const odd: ColorSource = {
      computedColor: () => "color(display-p3 1 0 0)",
      computedFont: () => "x",
      rasterize: () => ({ r: 1, g: 2, b: 3, a: 1 }),
    };
    expect(readPalette(odd).colors.bg).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(() => readPalette({ ...odd, rasterize: undefined })).toThrow(/token "bg".*display-p3/);
  });
});

describe("domColorSource", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("reads through a probe that points at the token and is removed afterwards", () => {
    const seen: string[] = [];
    vi.spyOn(window, "getComputedStyle").mockImplementation(((element: Element) => {
      const style = (element as HTMLElement).style;
      seen.push(style.color || style.fontFamily);
      return { color: "rgb(1 2 3)", fontFamily: "Test Face" } as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle);

    const source = domColorSource(document.body);
    expect(source.computedColor("line-strong")).toBe("rgb(1 2 3)");
    expect(source.computedFont("font-mono")).toBe("Test Face");
    expect(seen[0]).toContain("var(--rh-line-strong)");
    expect(seen[1]).toContain("var(--rh-font-mono)");
    expect(document.body.children).toHaveLength(0);
  });
});

describe("watchPalette", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it("reports a change when the theme attribute changes, and stops when told", async () => {
    const blocks = readTokenBlocks();
    const source: ColorSource = {
      computedColor: (token) => {
        const dark = document.documentElement.getAttribute("data-theme") === "dark";
        return sourceFor(dark ? blocks.darkOverride : blocks.light, blocks.light).computedColor(token);
      },
      computedFont: () => "x",
    };
    const seen: string[] = [];
    const stop = watchPalette(document, source, (palette) => seen.push(palette.scheme));

    document.documentElement.setAttribute("data-theme", "dark");
    await flush();
    expect(seen).toEqual(["dark"]);

    stop();
    document.documentElement.setAttribute("data-theme", "light");
    await flush();
    expect(seen).toEqual(["dark"]);
  });
});
