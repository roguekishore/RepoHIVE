import type { ArchitectureBody } from "./view-types";

export type DsmGroup = ArchitectureBody["dsm"]["groups"][number];
export type DsmBlock = ArchitectureBody["dsm"]["blocks"][number];
export type DsmGroupState = DsmGroup["state"];

const MIN_CELL = 8;
const MAX_CELL = 16;
const MAX_WIDTH = 760;

/** The side of one matrix cell, in SVG units, for a column `width` pixels wide and `groups` rows. */
export function cellSize(width: number, groups: number): number {
  if (groups <= 0) return MAX_CELL;
  return Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor((Math.min(width, MAX_WIDTH) - 2) / groups)));
}

/** The block (region on the diagonal) that holds the group at `index`, or `undefined`. */
export function blockOf(blocks: readonly DsmBlock[], index: number): DsmBlock | undefined {
  return blocks.find((block) => index >= block.start && index < block.start + block.size);
}

/** The matrix cell under a point, given the svg's box and the units it draws. `undefined` outside the matrix. */
export function cellAt(
  clientX: number,
  clientY: number,
  box: { readonly left: number; readonly top: number; readonly width: number },
  cell: number,
  groups: number,
): { readonly x: number; readonly y: number } | undefined {
  if (box.width <= 0) return undefined;
  const side = cell * groups;
  const scale = (side + 2) / box.width;
  const x = Math.floor(((clientX - box.left) * scale - 1) / cell);
  const y = Math.floor(((clientY - box.top) * scale - 1) / cell);
  if (x < 0 || y < 0 || x >= groups || y >= groups) return undefined;
  return { x, y };
}

/** How a block is drawn and worded. `none` is a block whose region has no recorded decision. */
export type BlockLook = "kept" | "rebuilt" | "unassessed";

export function blockLook(state: DsmGroupState): BlockLook {
  if (state === "preserve") return "kept";
  if (state === "reconstruct") return "rebuilt";
  return "unassessed";
}

export const BLOCK_PHRASE: Record<BlockLook, string> = {
  kept: "kept as authored",
  rebuilt: "rebuilt from dependencies",
  unassessed: "not assessed",
};
