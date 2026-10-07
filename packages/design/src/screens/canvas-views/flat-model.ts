import { forceLayout } from "../../canvas/layout";
import type { GraphBody } from "./view-types";

/** The flat file graph drawn on a world 1000 units across, as the Screens artifact lays it out. */
export const FLAT_WORLD = 1000;
/** The seed of the layout: the same graph always lands in the same place. */
const LAYOUT_SEED = "flat-baseline";
const LAYOUT_ITERATIONS = 120;

export interface FlatGraph {
  /** One entry per recorded file, in the recorded (path) order. */
  readonly ids: readonly string[];
  readonly names: readonly string[];
  /** The folder each file sits in: its recorded path without the file name. */
  readonly folders: readonly string[];
  /** Each file's neighbours, by position, sorted by position. A pair of imports in both directions is one neighbour. */
  readonly adjacent: readonly (readonly number[])[];
  /** Every recorded import, as a pair of positions. */
  readonly imports: readonly (readonly [number, number])[];
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** The graph body as positions and neighbour lists. Imports that name a file the body does not list are dropped. */
export function buildFlatGraph(data: GraphBody): FlatGraph {
  const ids = data.nodes.map((node) => node.node_id);
  const position = new Map(ids.map((id, index) => [id, index] as const));
  const neighbours: Set<number>[] = ids.map(() => new Set<number>());
  const imports: [number, number][] = [];
  for (const link of data.links) {
    const a = position.get(link.source);
    const b = position.get(link.target);
    if (a === undefined || b === undefined || a === b) continue;
    imports.push([a, b]);
    neighbours[a]!.add(b);
    neighbours[b]!.add(a);
  }
  return {
    ids,
    names: ids.map(fileName),
    folders: ids.map(folderOf),
    adjacent: neighbours.map((set) => [...set].sort((x, y) => x - y)),
    imports,
  };
}

export interface FlatPlacement {
  readonly x: Float64Array;
  readonly y: Float64Array;
}

/** Positions in world units, by the shared seeded force layout. Pure: the same graph gives the same numbers. */
export function placeFlatGraph(graph: FlatGraph): FlatPlacement {
  const placed = forceLayout(
    graph.ids.map((id) => ({ id })),
    graph.imports.map(([a, b]) => ({ source: graph.ids[a]!, target: graph.ids[b]! })),
    { seed: LAYOUT_SEED, iterations: LAYOUT_ITERATIONS },
  );
  const x = new Float64Array(graph.ids.length);
  const y = new Float64Array(graph.ids.length);
  graph.ids.forEach((id, index) => {
    const point = placed.get(id);
    x[index] = (point?.x ?? 0.5) * FLAT_WORLD;
    y[index] = (point?.y ?? 0.5) * FLAT_WORLD;
  });
  return { x, y };
}
