/** The small maths the film shares: easing, interpolation and a seeded generator. Pure, no clock, no `Math.random`. */

export const PI = Math.PI;
export const TAU = Math.PI * 2;

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** How far `t` has travelled from `a` to `b`, clamped to 0..1. */
export const seg = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
export const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
export const expoOut = (x: number): number => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
export const expoIn = (x: number): number => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10));
export const expoInOut = (x: number): number =>
  x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2;
export const backOut = (x: number): number => {
  const c1 = 1.25;
  const c3 = c1 + 1;
  return x <= 0 ? 0 : x >= 1 ? 1 : 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
/** 0 to 1 and back to 0 across `[a, b]`. */
export const bump = (t: number, a: number, b: number): number => Math.sin(PI * seg(t, a, b));

/** Mulberry32: the same seed always gives the same sequence. */
export function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
