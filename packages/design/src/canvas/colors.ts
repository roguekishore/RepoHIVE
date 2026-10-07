/**
 * The shared canvas colour resolver. Canvases (the map, the film, the charts) never hold a colour: they ask this module
 * for the current value of a token and repaint when the theme changes.
 *
 * The tokens are OKLCH, and a canvas needs numbers it can mix, so a token is read through a probe element (the browser
 * resolves `var(--rh-bg)` and the theme for us) and the computed string is parsed here. The parser covers what a
 * browser serialises for these tokens (`oklch()`, `rgb()`, `color(srgb)`, hex); anything else is rasterised on a 1×1
 * canvas as a last resort, which needs a real canvas. Nothing here is random or reads the clock.
 */
import { COLOR_TOKENS, tokenVar, type ColorToken } from "../tokens/names";

/** Channels 0 to 255 in sRGB, alpha 0 to 1. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface CanvasPalette {
  readonly colors: Readonly<Record<ColorToken, Rgba>>;
  /** The computed `font-family` lists, ready for `ctx.font = "12px " + palette.sans`. */
  readonly sans: string;
  readonly mono: string;
  /** From the background's lightness, so it follows an explicit override and the system setting alike. */
  readonly scheme: "light" | "dark";
}

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

function gamma(linear: number): number {
  const v = clamp(linear, 0, 1);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** OKLab to sRGB (channels 0 to 255), clipping out-of-gamut values. */
export function oklabToRgb(L: number, a: number, b: number): readonly [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  // Snapped so that white is 255 and not 254.99999999999997.
  const snap = (value: number): number => Math.round(value * 1e6) / 1e6;
  return [snap(gamma(r) * 255), snap(gamma(g) * 255), snap(gamma(bl) * 255)];
}

const NUMBER = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?";

/** A component that is a number, a percentage or `none`. `percentOf` is the value 100% stands for. */
function component(token: string | undefined, percentOf: number): number | undefined {
  if (token === undefined) return undefined;
  const text = token.trim().toLowerCase();
  if (text === "none") return 0;
  const match = new RegExp(`^(${NUMBER})(%|deg|rad|turn|grad)?$`).exec(text);
  if (match === null) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  switch (match[2]) {
    case "%":
      return (value / 100) * percentOf;
    case "rad":
      return (value * 180) / Math.PI;
    case "turn":
      return value * 360;
    case "grad":
      return value * 0.9;
    default:
      return value;
  }
}

function splitArguments(name: string, body: string): { channels: string[]; alpha: string | undefined } | undefined {
  const [colour, alpha, ...rest] = body.split("/");
  if (rest.length > 0 || colour === undefined) return undefined;
  const channels = colour
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter((part) => part !== "");
  // The legacy comma syntax, rgba(r, g, b, a), carries alpha as a fourth channel instead of after a slash.
  if (alpha === undefined && channels.length === 4 && /^rgba?$/.test(name)) {
    return { channels: channels.slice(0, 3), alpha: channels[3] };
  }
  return { channels, alpha: alpha?.trim() };
}

function alphaOf(token: string | undefined): number | undefined {
  if (token === undefined) return 1;
  const value = component(token, 1);
  return value === undefined ? undefined : clamp(value, 0, 1);
}

/** Parses a computed colour string; `undefined` when the syntax is not one this module reads. */
export function parseColor(input: string): Rgba | undefined {
  const text = input.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex !== null) {
    const digits = hex[1] ?? "";
    const full =
      digits.length === 3 || digits.length === 4
        ? [...digits].map((d) => d + d).join("")
        : digits.length === 6 || digits.length === 8
          ? digits
          : undefined;
    if (full === undefined) return undefined;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }

  const fn = /^([a-z-]+)\((.*)\)$/.exec(text);
  if (fn === null) return undefined;
  const name = fn[1];
  const args = splitArguments(name ?? "", fn[2] ?? "");
  if (args === undefined) return undefined;
  const alpha = alphaOf(args.alpha);
  if (alpha === undefined) return undefined;
  const [c1, c2, c3] = args.channels;

  if (name === "rgb" || name === "rgba") {
    const r = component(c1, 255);
    const g = component(c2, 255);
    const b = component(c3, 255);
    if (r === undefined || g === undefined || b === undefined) return undefined;
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: alpha };
  }

  if (name === "color" && c1 === "srgb") {
    const [, r, g, b] = args.channels.map((part) => component(part, 1));
    if (r === undefined || g === undefined || b === undefined) return undefined;
    return { r: clamp(r, 0, 1) * 255, g: clamp(g, 0, 1) * 255, b: clamp(b, 0, 1) * 255, a: alpha };
  }

  if (name === "oklch") {
    const L = component(c1, 1);
    const C = component(c2, 0.4);
    const H = component(c3, 360);
    if (L === undefined || C === undefined || H === undefined) return undefined;
    const radians = (H * Math.PI) / 180;
    const [r, g, b] = oklabToRgb(clamp(L, 0, 1), C * Math.cos(radians), C * Math.sin(radians));
    return { r, g, b, a: alpha };
  }

  if (name === "oklab") {
    const L = component(c1, 1);
    const a = component(c2, 0.4);
    const b = component(c3, 0.4);
    if (L === undefined || a === undefined || b === undefined) return undefined;
    const [r, g, bl] = oklabToRgb(clamp(L, 0, 1), a, b);
    return { r, g, b: bl, a: alpha };
  }

  return undefined;
}

/** `rgb(r g b / a)` with integer channels, for `ctx.fillStyle`. `alpha` multiplies the colour's own alpha. */
export function rgbaCss(colour: Rgba, alpha = 1): string {
  const a = clamp(colour.a * alpha, 0, 1);
  const channels = `${Math.round(colour.r)} ${Math.round(colour.g)} ${Math.round(colour.b)}`;
  return a === 1 ? `rgb(${channels})` : `rgb(${channels} / ${Number(a.toFixed(3))})`;
}

/** A blend in sRGB, `amount` 0 giving `from` and 1 giving `to`. */
export function mixColors(from: Rgba, to: Rgba, amount: number): Rgba {
  const p = clamp(amount, 0, 1);
  return {
    r: from.r + (to.r - from.r) * p,
    g: from.g + (to.g - from.g) * p,
    b: from.b + (to.b - from.b) * p,
    a: from.a + (to.a - from.a) * p,
  };
}

/** Relative luminance, 0 to 1, of an sRGB colour. */
export function luminance(colour: Rgba): number {
  const channel = (value: number): number => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
}

/** What the resolver needs from the page; replaceable so tests need neither a browser engine nor a canvas. */
export interface ColorSource {
  /** The computed `color` of `var(--rh-<token>)`. */
  computedColor(token: string): string;
  /** The computed `font-family` of `var(--rh-<token>)`. */
  computedFont(token: string): string;
  /** Last resort for a syntax {@link parseColor} does not read. */
  rasterize?(value: string): Rgba | undefined;
}

function rasterizeOnCanvas(doc: Document): ColorSource["rasterize"] {
  return (value) => {
    const canvas = doc.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx === null) return undefined;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    return { r: pixel[0] ?? 0, g: pixel[1] ?? 0, b: pixel[2] ?? 0, a: (pixel[3] ?? 255) / 255 };
  };
}

/** Reads tokens through a probe element appended to `root`; the probe lives only for the duration of one read. */
export function domColorSource(root: Element): ColorSource {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (view === null) throw new Error("design: the colour resolver needs a document with a window");
  const withProbe = <T>(apply: (probe: HTMLElement) => T): T => {
    const probe = doc.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.position = "absolute";
    probe.style.width = "0";
    probe.style.height = "0";
    probe.style.overflow = "hidden";
    root.appendChild(probe);
    try {
      return apply(probe);
    } finally {
      probe.remove();
    }
  };
  return {
    computedColor: (token) =>
      withProbe((probe) => {
        probe.style.color = `var(${tokenVar(token)})`;
        return view.getComputedStyle(probe).color;
      }),
    computedFont: (token) =>
      withProbe((probe) => {
        probe.style.fontFamily = `var(${tokenVar(token)})`;
        return view.getComputedStyle(probe).fontFamily;
      }),
    rasterize: rasterizeOnCanvas(doc),
  };
}

function resolveOne(source: ColorSource, token: ColorToken): Rgba {
  const computed = source.computedColor(token);
  const parsed = parseColor(computed) ?? source.rasterize?.(computed);
  if (parsed === undefined) {
    throw new Error(`design: cannot read the colour of token "${token}" (computed "${computed}")`);
  }
  return parsed;
}

/** Reads every colour token and both font stacks from the page as it is now. */
export function readPalette(source: ColorSource): CanvasPalette {
  const colors = {} as Record<ColorToken, Rgba>;
  for (const token of COLOR_TOKENS) colors[token] = resolveOne(source, token);
  return {
    colors,
    sans: source.computedFont("font-sans"),
    mono: source.computedFont("font-mono"),
    scheme: luminance(colors.bg) < 0.5 ? "dark" : "light",
  };
}

/**
 * Calls `onChange` with a fresh palette whenever the theme can have changed: the `data-theme` or `class` attribute on
 * the root, the system colour scheme, or web fonts finishing loading. Returns the function that stops watching. It does
 * not call `onChange` for the initial value; read that with {@link readPalette}.
 */
export function watchPalette(doc: Document, source: ColorSource, onChange: (palette: CanvasPalette) => void): () => void {
  const view = doc.defaultView;
  if (view === null) return () => undefined;
  let active = true;
  const refresh = (): void => {
    if (active) onChange(readPalette(source));
  };

  const observer = new view.MutationObserver(refresh);
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });

  const query = typeof view.matchMedia === "function" ? view.matchMedia("(prefers-color-scheme: dark)") : undefined;
  query?.addEventListener("change", refresh);

  void doc.fonts?.ready.then(refresh);

  return () => {
    active = false;
    observer.disconnect();
    query?.removeEventListener("change", refresh);
  };
}
