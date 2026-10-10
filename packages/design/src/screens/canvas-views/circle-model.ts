/**
 * The Circles scene: the recorded containment tree as nested circles. The repository is one circle, each card inside
 * it is a circle packed into it by its recorded file count, and a circle opens into its own children as you zoom. A run
 * of single-child cards is one circle (it would add a zoom step that shows nothing new). The packing is the shared
 * seeded one, so the same snapshot is always the same picture; the radius follows the recorded count.
 */
import { packCircles } from "../../canvas/layout";
import { buildMapModel, type MapModel, type MapNode } from "../map/model";
import type { ZoomMapBody } from "./view-types";

/** The most children packed into one circle; the rest are counted, not drawn. */
export const MAX_PACKED = 300;
/** Share of a circle's radius its children are packed into; the rest holds its title. */
const INNER = 0.88;
const GAP = 0.04;

export interface Circle {
  /** The deepest card of the collapsed run; its children are this circle's children. */
  readonly id: number;
  /** The run, outermost first: one card unless single-child cards collapsed. */
  readonly chain: readonly number[];
  readonly label: string;
  /** The enclosing circle, or -1 for the root. */
  readonly parent: number;
  readonly kids: readonly number[];
  /** Children left out of the packing because there were more than {@link MAX_PACKED}. */
  readonly omitted: number;
  readonly depth: number;
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface CircleModel {
  readonly map: MapModel;
  readonly root: number;
  /** Circles by id (the deepest card's position in the map model); `undefined` for a card inside a collapsed run. */
  readonly circles: readonly (Circle | undefined)[];
  /** Ids in draw order: every circle after the one that encloses it. */
  readonly order: readonly number[];
  /** For every card, the circle that shows it. */
  readonly circleOf: readonly number[];
}

function collapse(map: MapModel, start: number): number[] {
  const chain = [start];
  let current = map.nodes[start];
  while (current !== undefined && current.kids.length === 1) {
    const next = current.kids[0];
    if (next === undefined) break;
    chain.push(next);
    current = map.nodes[next];
  }
  return chain;
}

const nameOf = (node: MapNode | undefined): string => node?.name ?? "";

export function buildCircleModel(body: ZoomMapBody): CircleModel {
  const map = buildMapModel(body);
  const circles: (Circle | undefined)[] = new Array<Circle | undefined>(map.nodes.length).fill(undefined);
  const circleOf: number[] = new Array<number>(map.nodes.length).fill(-1);
  const order: number[] = [];
  if (map.nodes.length === 0) return { map, root: -1, circles, order, circleOf };

  const rootChain = collapse(map, 0);
  const rootId = rootChain[rootChain.length - 1] ?? 0;
  const queue: { chain: number[]; parent: number; depth: number; x: number; y: number; r: number }[] = [{ chain: rootChain, parent: -1, depth: 0, x: 0.5, y: 0.5, r: 0.5 }];

  for (let head = 0; head < queue.length; head += 1) {
    const item = queue[head];
    if (item === undefined) continue;
    const id = item.chain[item.chain.length - 1] ?? 0;
    const node = map.nodes[id];
    const kids = (node?.kids ?? []).map((kid) => collapse(map, kid));
    // The largest first, so what is left out is the smallest; the position breaks ties.
    const ranked = [...kids].sort((a, b) => (map.nodes[b[b.length - 1] ?? 0]?.files ?? 0) - (map.nodes[a[a.length - 1] ?? 0]?.files ?? 0) || (a[0] ?? 0) - (b[0] ?? 0));
    const packed = ranked.slice(0, MAX_PACKED);
    const packing = packCircles(
      packed.map((chain) => ({ key: String(chain[chain.length - 1]), r: Math.sqrt(Math.max(1, map.nodes[chain[chain.length - 1] ?? 0]?.files ?? 1)) })),
      GAP * Math.max(1, ...packed.map((chain) => Math.sqrt(Math.max(1, map.nodes[chain[chain.length - 1] ?? 0]?.files ?? 1)))),
    );
    const scale = packing.radius > 0 ? (item.r * INNER) / packing.radius : 0;
    const placed = new Map(packing.circles.map((circle) => [circle.key, circle] as const));

    const kidIds: number[] = [];
    for (const chain of packed) {
      const kidId = chain[chain.length - 1] ?? 0;
      const spot = placed.get(String(kidId));
      if (spot === undefined) continue;
      kidIds.push(kidId);
      queue.push({ chain, parent: id, depth: item.depth + 1, x: item.x + spot.x * scale, y: item.y + spot.y * scale, r: spot.r * scale });
    }
    kidIds.sort((a, b) => a - b);

    circles[id] = {
      id,
      chain: item.chain,
      label: item.chain.map((index) => nameOf(map.nodes[index])).join(" / "),
      parent: item.parent,
      kids: kidIds,
      omitted: Math.max(0, kids.length - packed.length),
      depth: item.depth,
      x: item.x,
      y: item.y,
      r: item.r,
    };
    for (const index of item.chain) circleOf[index] = id;
    order.push(id);
  }
  return { map, root: rootId, circles, order, circleOf };
}

/** The circles from the root down to `id`, inclusive. */
export function pathTo(model: CircleModel, id: number): number[] {
  const path: number[] = [];
  let current: number = id;
  while (current >= 0) {
    path.push(current);
    current = model.circles[current]?.parent ?? -1;
  }
  return path.reverse();
}
