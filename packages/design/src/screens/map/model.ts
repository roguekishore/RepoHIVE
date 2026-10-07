/**
 * The Map's data model: the recorded zoom map turned into an indexed tree with a stable layout. Every value on a card
 * is read from the view body (names, file counts, the recorded decision, the recorded relations); the layout only
 * decides where a card sits and how big it is drawn (seeded, so the same index gives the same map).
 */
import type { Rect } from "../../canvas/camera";
import { squarify } from "../../canvas/layout";
import type { ZoomMap, ZoomNode } from "@repohive/views";

export type MapKind = ZoomNode["kind"];

/** The decision recorded for a card's region: kept (preserve), rebuilt (reconstruct), or none recorded. */
export type MapDecision = "kept" | "rebuilt" | null;

export interface MapNode {
  /** Position in `MapModel.nodes`; the root is 0. */
  readonly i: number;
  readonly id: string;
  /** Parent position, or -1 for the root. */
  readonly parent: number;
  readonly kind: MapKind;
  readonly name: string;
  readonly path: string;
  readonly level: number;
  /** `metrics.file_count` as recorded. */
  readonly files: number;
  readonly kids: readonly number[];
  readonly decision: MapDecision;
  /** The recorded decision text (action, quality, confidence), empty when none. */
  readonly summary: string;
}

/** A relation between two sibling cards, as recorded. */
export interface MapRelation {
  readonly source: number;
  readonly target: number;
  /** The recorded `edge_count`. */
  readonly count: number;
  /** The recorded band (`loose`, `moderate`, `tight`). */
  readonly coupling: string;
}

export interface MapModel {
  readonly nodes: readonly MapNode[];
  /** Where each card sits, in root space (the root is the unit square); index by `MapNode.i`. */
  readonly rects: readonly Rect[];
  /** Relations among the children of a card, by parent position. */
  readonly relations: ReadonlyMap<number, readonly MapRelation[]>;
  readonly totalFiles: number;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function decisionOf(node: ZoomNode): MapDecision {
  if (node.decision === "preserve") return "kept";
  if (node.decision === "reconstruct") return "rebuilt";
  return null;
}

/** Space kept inside a card around its children, and the strip for its title, as fractions of the card. */
const PAD = 0.035;
const HEAD = 0.1;

/** The area inside `rect` that holds its children. */
export function innerRect(rect: Rect): Rect {
  const pad = Math.min(rect.w, rect.h) * PAD;
  const head = rect.h * HEAD;
  return { x: rect.x + pad, y: rect.y + pad + head, w: Math.max(rect.w - 2 * pad, 0), h: Math.max(rect.h - 2 * pad - head, 0) };
}

/** The share of a card's height the title strip takes when it is open. */
export const TITLE_STRIP = HEAD;

export function buildMapModel(map: ZoomMap): MapModel {
  const byId = new Map<string, ZoomNode>(map.nodes.map((node) => [node.id, node]));
  const root = byId.get(map.root_id) ?? map.nodes[0];
  if (root === undefined) return { nodes: [], rects: [], relations: new Map(), totalFiles: 0 };

  // Depth-first from the root in the recorded child order, so positions are a function of the data alone.
  const order: ZoomNode[] = [];
  const position = new Map<string, number>();
  const visit = (node: ZoomNode): void => {
    position.set(node.id, order.length);
    order.push(node);
    for (const childId of node.children) {
      const child = byId.get(childId);
      if (child !== undefined && !position.has(child.id)) visit(child);
    }
  };
  visit(root);

  const nodes: MapNode[] = order.map((node, i) => ({
    i,
    id: node.id,
    parent: node.parent_id === null ? -1 : (position.get(node.parent_id) ?? -1),
    kind: node.kind,
    name: node.name,
    path: node.path,
    level: node.level,
    files: node.metrics.file_count,
    kids: node.children.flatMap((id) => {
      const at = position.get(id);
      return at === undefined ? [] : [at];
    }),
    decision: decisionOf(node),
    summary: node.summary,
  }));

  // The layout: a squarified treemap of each card's children inside its inner rectangle. A card's area follows the
  // square root of its recorded file count, so a very large region does not shrink its neighbours to slivers.
  const rects: Rect[] = new Array<Rect>(nodes.length);
  rects[0] = { x: 0, y: 0, w: 1, h: 1 };
  const seed = map.root_id;
  for (const node of nodes) {
    const rect = rects[node.i];
    if (rect === undefined || node.kids.length === 0) continue;
    const placed = squarify(
      node.kids.map((kid) => ({ key: String(kid), weight: Math.sqrt(Math.max(1, nodes[kid]?.files ?? 1)) })),
      innerRect(rect),
      `${seed}\u0000${node.id}`,
    );
    for (const item of placed) rects[Number(item.key)] = item.rect;
  }

  const relations = new Map<number, MapRelation[]>();
  for (const relation of map.relations) {
    const parent = position.get(relation.parent_id);
    const source = position.get(relation.source_id);
    const target = position.get(relation.target_id);
    if (parent === undefined || source === undefined || target === undefined || source === target) continue;
    const list = relations.get(parent) ?? [];
    list.push({ source, target, count: relation.edge_count, coupling: relation.coupling });
    relations.set(parent, list);
  }
  for (const list of relations.values()) {
    list.sort((a, b) => b.count - a.count || a.source - b.source || a.target - b.target);
  }

  return { nodes, rects, relations, totalFiles: map.total_files };
}

/** A card's links to its siblings, strongest first, as the inspector lists them. */
export interface MapLink {
  readonly other: number;
  readonly direction: "uses" | "used by";
  readonly count: number;
}

export function linksOf(model: MapModel, index: number): { uses: MapLink[]; usedBy: MapLink[] } {
  const node = model.nodes[index];
  const uses: MapLink[] = [];
  const usedBy: MapLink[] = [];
  if (node === undefined) return { uses, usedBy };
  for (const relation of model.relations.get(node.parent) ?? []) {
    if (relation.source === index) uses.push({ other: relation.target, direction: "uses", count: relation.count });
    else if (relation.target === index) usedBy.push({ other: relation.source, direction: "used by", count: relation.count });
  }
  return { uses, usedBy };
}

/** The first card whose name contains `term`: names that start with it first, then shorter names, then position. */
export function findCard(model: MapModel, term: string): number {
  const needle = term.trim().toLowerCase();
  if (needle === "") return -1;
  let best = -1;
  let bestScore = Infinity;
  for (const node of model.nodes) {
    if (node.i === 0) continue;
    const name = node.name.toLowerCase();
    const at = name.indexOf(needle);
    if (at < 0) continue;
    const score = (at === 0 ? 0 : 1000) + name.length;
    if (score < bestScore || (score === bestScore && compare(node.id, model.nodes[best]?.id ?? "") < 0)) {
      bestScore = score;
      best = node.i;
    }
  }
  return best;
}
