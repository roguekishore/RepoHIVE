import { describe, expect, it } from "vitest";
import { forceLayout, packCards, packCircles, squarify } from "./layout";

const area = (r: { w: number; h: number }): number => r.w * r.h;

describe("squarify", () => {
  const items = [
    { key: "a", weight: 6 },
    { key: "b", weight: 6 },
    { key: "c", weight: 4 },
    { key: "d", weight: 3 },
    { key: "e", weight: 2 },
    { key: "f", weight: 2 },
    { key: "g", weight: 1 },
  ];
  const rect = { x: 0.1, y: 0.2, w: 1.6, h: 0.9 };

  it("tiles the rectangle exactly, with areas in proportion to the weights", () => {
    const placed = squarify(items, rect, "s");
    expect(placed).toHaveLength(items.length);
    expect(placed.reduce((sum, p) => sum + area(p.rect), 0)).toBeCloseTo(area(rect), 9);
    const total = items.reduce((sum, i) => sum + i.weight, 0);
    for (const p of placed) {
      const weight = items.find((i) => i.key === p.key)?.weight ?? 0;
      expect(area(p.rect)).toBeCloseTo((weight / total) * area(rect), 9);
      expect(p.rect.x).toBeGreaterThanOrEqual(rect.x - 1e-9);
      expect(p.rect.y).toBeGreaterThanOrEqual(rect.y - 1e-9);
      expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(rect.x + rect.w + 1e-9);
      expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(rect.y + rect.h + 1e-9);
    }
  });

  it("leaves no overlap", () => {
    const placed = squarify(items, rect, 1);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!.rect;
        const b = placed[j]!.rect;
        const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(overlapW > 1e-9 && overlapH > 1e-9).toBe(false);
      }
    }
  });

  it("gives the same layout for the same seed whatever order the items arrive in", () => {
    const forward = squarify(items, rect, "seed");
    const reversed = squarify([...items].reverse(), rect, "seed");
    const byKey = (list: typeof forward) => Object.fromEntries(list.map((p) => [p.key, p.rect]));
    expect(byKey(reversed)).toEqual(byKey(forward));
  });

  it("breaks ties by the seed, so another seed may arrange equal items differently", () => {
    const equal = Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, weight: 1 }));
    const unit = { x: 0, y: 0, w: 1, h: 1 };
    const order = (seed: string): string => squarify(equal, unit, seed).map((p) => p.key).join();
    expect(order("one")).toBe(order("one"));
    expect(new Set(["one", "two", "three", "four", "five"].map(order)).size).toBeGreaterThan(1);
  });

  it("copes with one item, none, zero weights and an empty rectangle", () => {
    expect(squarify([], rect)).toEqual([]);
    expect(squarify([{ key: "x", weight: 5 }], rect)[0]?.rect).toEqual(rect);
    expect(squarify([{ key: "x", weight: 0 }, { key: "y", weight: 0 }], rect)).toHaveLength(2);
    expect(squarify(items, { x: 0, y: 0, w: 0, h: 1 })).toEqual([]);
  });

  it("keeps the pieces reasonably square", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ key: `n${i}`, weight: 1 + (i % 7) }));
    const worst = Math.max(...squarify(many, { x: 0, y: 0, w: 1, h: 1 }).map((p) => Math.max(p.rect.w / p.rect.h, p.rect.h / p.rect.w)));
    expect(worst).toBeLessThan(4);
  });
});

describe("forceLayout", () => {
  const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}` }));
  const edges = [
    ...Array.from({ length: 14 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` })),
    ...Array.from({ length: 14 }, (_, i) => ({ source: `n${16 + i}`, target: `n${15 + i}` })),
  ];

  it("is a pure function of its input and seed", () => {
    const a = Object.fromEntries(forceLayout(nodes, edges, { seed: 3 }));
    const b = Object.fromEntries(forceLayout([...nodes].reverse(), [...edges].reverse(), { seed: 3 }));
    expect(b).toEqual(a);
    expect(Object.fromEntries(forceLayout(nodes, edges, { seed: 4 }))).not.toEqual(a);
  });

  it("returns every node inside the unit square", () => {
    const out = forceLayout(nodes, edges, { seed: 1 });
    expect(out.size).toBe(30);
    for (const p of out.values()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it("draws linked nodes closer than unlinked ones, on average", () => {
    const out = forceLayout(nodes, edges, { seed: 1 });
    const d = (a: string, b: string): number => {
      const p = out.get(a)!;
      const q = out.get(b)!;
      return Math.hypot(p.x - q.x, p.y - q.y);
    };
    const linked = edges.reduce((sum, e) => sum + d(e.source, e.target), 0) / edges.length;
    let all = 0;
    let count = 0;
    for (let i = 0; i < 30; i++) {
      for (let j = i + 1; j < 30; j++) {
        all += d(`n${i}`, `n${j}`);
        count++;
      }
    }
    expect(linked).toBeLessThan(all / count);
  });

  it("handles none, one, and edges to unknown nodes", () => {
    expect(forceLayout([], []).size).toBe(0);
    expect(forceLayout([{ id: "a" }], []).get("a")).toEqual({ x: 0.5, y: 0.5 });
    expect(forceLayout([{ id: "a" }, { id: "b" }], [{ source: "a", target: "zzz" }]).size).toBe(2);
  });

  it("lays out a few thousand nodes in reasonable time", () => {
    const big = Array.from({ length: 3000 }, (_, i) => ({ id: `f${i}` }));
    const links = big.slice(1).map((n, i) => ({ source: n.id, target: `f${Math.floor(i / 3)}` }));
    const started = performance.now();
    expect(forceLayout(big, links, { seed: 1, iterations: 60 }).size).toBe(3000);
    expect(performance.now() - started).toBeLessThan(10000);
  });
});

describe("packCircles", () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ key: `c${i}`, r: 1 + (i % 5) }));

  it("leaves no overlap and encloses every circle", () => {
    const packing = packCircles(items, 0.5);
    expect(packing.circles).toHaveLength(25);
    for (let i = 0; i < 25; i++) {
      const a = packing.circles[i]!;
      expect(Math.hypot(a.x, a.y) + a.r).toBeLessThanOrEqual(packing.radius + 1e-9);
      for (let j = i + 1; j < 25; j++) {
        const b = packing.circles[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r + 0.5 - 1e-9);
      }
    }
  });

  it("is deterministic whatever order the items arrive in", () => {
    const a = packCircles(items).circles;
    const b = packCircles([...items].reverse()).circles;
    const by = (list: typeof a) => Object.fromEntries(list.map((c) => [c.key, [c.x, c.y]]));
    expect(by(b)).toEqual(by(a));
  });

  it("copes with nothing", () => {
    expect(packCircles([])).toEqual({ circles: [], radius: 0 });
  });
});

describe("packCards", () => {
  const kids = ["a", "b", "c", "d", "e"].map((key, i) => ({ key, rank: i, importance: 5 - i }));

  it("leaves space between cards and keeps them inside the unit square", () => {
    const placed = [...packCards(kids, 1.5).values()];
    expect(placed).toHaveLength(5);
    for (const r of placed) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
    }
    for (const [i, p] of placed.entries()) {
      for (const q of placed.slice(i + 1)) {
        const apart = p.x + p.w < q.x || q.x + q.w < p.x || p.y + p.h < q.y || q.y + q.h < p.y;
        expect(apart).toBe(true);
      }
    }
  });

  it("sizes by importance and is the same on every call", () => {
    const first = packCards(kids, 1.5);
    expect(first.get("a")!.h).toBeGreaterThan(first.get("e")!.h);
    expect(packCards([...kids].reverse(), 1.5)).toEqual(first);
  });
});
