/**
 * Hit testing for a canvas. A draw pass registers every shape it paints that can be hovered or clicked, in screen
 * pixels, and the pointer handlers ask which one is under the pointer. The index is cleared before each draw, so it
 * always describes what is on screen.
 */

interface Entry<T> {
  readonly kind: "rect" | "circle";
  readonly x: number;
  readonly y: number;
  /** Width and height of a rectangle; the radius (in `w`) of a circle. */
  readonly w: number;
  readonly h: number;
  readonly value: T;
  readonly depth: number;
}

export class HitIndex<T> {
  private entries: Entry<T>[] = [];

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }

  addRect(x: number, y: number, w: number, h: number, value: T, depth = 0): void {
    this.entries.push({ kind: "rect", x, y, w, h, value, depth });
  }

  addCircle(x: number, y: number, radius: number, value: T, depth = 0): void {
    this.entries.push({ kind: "circle", x, y, w: radius, h: radius, value, depth });
  }

  /**
   * The shape under (`x`, `y`): the one with the greatest `depth`, and among equals the one registered last (drawn on
   * top). `slop` grows every shape by that many pixels, for small targets.
   */
  at(x: number, y: number, slop = 0): T | undefined {
    let best: Entry<T> | undefined;
    for (const entry of this.entries) {
      const inside =
        entry.kind === "rect"
          ? x >= entry.x - slop && x <= entry.x + entry.w + slop && y >= entry.y - slop && y <= entry.y + entry.h + slop
          : Math.hypot(x - entry.x, y - entry.y) <= entry.w + slop;
      if (inside && (best === undefined || entry.depth >= best.depth)) best = entry;
    }
    return best?.value;
  }
}
