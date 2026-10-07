/**
 * Seeded randomness for deterministic layout: the same seed gives the same sequence on every machine, so
 * identical input gives identical pixels. Nothing here reads the clock or `Math.random`.
 */

/** A 32-bit hash of the parts (FNV-1a with a final avalanche). Strings and numbers hash by their text. */
export function hashSeed(...parts: ReadonlyArray<string | number>): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    // A separator, so ("ab", "c") and ("a", "bc") differ.
    h ^= 0xff;
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A generator of numbers in [0, 1) (mulberry32). */
export function createRng(seed: number | string): () => number {
  let state = (typeof seed === "string" ? hashSeed(seed) : seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
