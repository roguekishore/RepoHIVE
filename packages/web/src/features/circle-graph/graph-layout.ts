/**
 * Graph layout for the children of one circle. Pure, browser-free and
 * unit-testable.
 *
 * Children are circles sized by how much code they hold, placed by a small
 * force simulation inside the parent: related siblings pull together, every
 * pair is kept apart by its radii, and a soft pull to the centre plus a hard
 * wall keep the cluster inside the parent's rim. There is no randomness: the
 * start is a sunflower spiral in rank order and every step is plain arithmetic
 * in a fixed order, so the same input always gives the same picture.
 *
 * Coordinates are in parent units: the parent is centred on the origin with
 * radius 1.
 */

/** Share of the parent's area the children cover; the rest is room for edges. */
export const FILL = 0.36;
/** Gap kept between the outermost child and the parent's rim. */
export const MARGIN = 0.06;
/** Minimum gap between two siblings. */
export const PAD = 0.04;
/** The smallest sibling is at least this fraction of the largest one's radius. */
export const MIN_SIZE_RATIO = 0.32;
/** No child is wider than this, so a lone big child still leaves visible room. */
export const MAX_CHILD = 0.44;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface LayoutLink {
  /** Indices into the child arrays. */
  a: number;
  b: number;
  weight: number;
}

/** Child radii (parent units) from their weights, e.g. file counts. */
export function childRadii(weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (n === 1) return [0.55];
  const raw = weights.map((w) => Math.sqrt(Math.max(1, w)));
  const max = Math.max(...raw);
  const floored = raw.map((r) => Math.max(r, max * MIN_SIZE_RATIO));
  const k = Math.sqrt(FILL / floored.reduce((s, r) => s + r * r, 0));
  return floored.map((r) => Math.min(MAX_CHILD, r * k));
}

/** Centres (parent units) for circles of `radii`, given in rank order (most important first). */
export function forceLayout(radii: number[], links: LayoutLink[]): Array<{ x: number; y: number }> {
  const n = radii.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];

  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const rho = 0.62 * Math.sqrt((i + 0.5) / n);
    xs[i] = rho * Math.cos(i * GOLDEN_ANGLE - Math.PI / 2);
    ys[i] = rho * Math.sin(i * GOLDEN_ANGLE - Math.PI / 2);
  }

  const maxW = Math.max(1, ...links.map((l) => l.weight));
  const iterations = n > 80 ? 120 : 300;

  const collide = () => {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = xs[j]! - xs[i]!;
        let dy = ys[j]! - ys[i]!;
        let d = Math.hypot(dx, dy);
        if (d < 1e-9) {
          // Coincident centres: separate along a fixed, index-derived direction.
          dx = Math.cos(j * GOLDEN_ANGLE);
          dy = Math.sin(j * GOLDEN_ANGLE);
          d = 1;
        }
        const min = radii[i]! + radii[j]! + PAD;
        if (d >= min) continue;
        const push = (min - d) / d;
        const ai = radii[i]! * radii[i]!;
        const aj = radii[j]! * radii[j]!;
        // The smaller circle moves more.
        const si = aj / (ai + aj);
        const sj = ai / (ai + aj);
        xs[i] -= dx * push * si;
        ys[i] -= dy * push * si;
        xs[j] += dx * push * sj;
        ys[j] += dy * push * sj;
      }
    }
  };

  const contain = () => {
    for (let i = 0; i < n; i++) {
      const lim = 1 - MARGIN - radii[i]!;
      const d = Math.hypot(xs[i]!, ys[i]!);
      if (lim <= 0) {
        xs[i] = 0;
        ys[i] = 0;
      } else if (d > lim) {
        xs[i] *= lim / d;
        ys[i] *= lim / d;
      }
    }
  };

  for (let t = 0; t < iterations; t++) {
    const alpha = 1 - t / iterations;
    for (const link of links) {
      const dx = xs[link.b]! - xs[link.a]!;
      const dy = ys[link.b]! - ys[link.a]!;
      const d = Math.hypot(dx, dy);
      const rest = radii[link.a]! + radii[link.b]! + PAD * 2;
      if (d <= rest || d < 1e-9) continue;
      const f = (0.06 * alpha * Math.sqrt(link.weight / maxW) * (d - rest)) / d;
      xs[link.a] += dx * f;
      ys[link.a] += dy * f;
      xs[link.b] -= dx * f;
      ys[link.b] -= dy * f;
    }
    for (let i = 0; i < n; i++) {
      xs[i] -= xs[i]! * 0.02 * alpha;
      ys[i] -= ys[i]! * 0.02 * alpha;
    }
    collide();
    contain();
  }
  for (let t = 0; t < 40; t++) {
    collide();
    contain();
  }

  return Array.from({ length: n }, (_, i) => ({ x: xs[i]!, y: ys[i]! }));
}
