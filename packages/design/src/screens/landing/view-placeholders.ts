import type { ArcRow, LandingFigures, MapRow, RegionRow } from "./figures-types";

/**
 * Constant stand-ins for the marks on the landing's view cards. The cards are a few hundred pixels wide, so a preview
 * needs a few dozen shapes, not the thousands a real index holds; drawing the real ones made the section slow. These
 * are illustrative and fixed (no clock, no randomness): they say what each view looks like, not what any repository
 * contains. The figures in the Overview card still come from the real index.
 */

/** Small repeatable sequence in [0, 1), so the shapes look irregular but never change. */
const wobble = (i: number): number => {
  const x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
  return x - Math.floor(x);
};

const REGIONS: readonly RegionRow[] = Array.from({ length: 40 }, (_, i): RegionRow => {
  const score = Math.min(0.97, Math.max(0.03, 0.12 + (i / 40) * 0.76 + (wobble(i) - 0.5) * 0.2));
  return [`region.${i}`, 20 + i, 0.5, 0.5, score, score >= 0.5 ? 1 : 2, 1];
});

/** Repository, three layers, three or four groups in each, three subgroups in each of those: 36 cards. */
const MAP: readonly MapRow[] = (() => {
  const rows: MapRow[] = [[-1, 100, 0, 0]];
  for (let layer = 0; layer < 3; layer++) {
    const layerAt = rows.length;
    rows.push([0, 60 - layer * 15, layer, 0]);
    for (let group = 0; group < 3; group++) {
      const groupAt = rows.length;
      rows.push([layerAt, 30 - group * 6 - layer * 2, group, group === 2 ? 2 : 1]);
      for (let leaf = 0; leaf < 3; leaf++) rows.push([groupAt, 12 - leaf * 3, leaf, 0]);
    }
  }
  return rows;
})();

/** Three rings of arcs that tile the circle: 4, 8 and 16. */
const ARCS: readonly ArcRow[] = [4, 8, 16].flatMap((count, ring) =>
  Array.from({ length: count }, (_, i): ArcRow => [ring + 1, i / count, 1 / count, 10, ((i + ring) % 3 === 2 ? 2 : (i + ring) % 5 === 4 ? 3 : 1) as 1 | 2 | 3]),
);

const FLAT_POINTS: readonly (readonly [number, number])[] = Array.from({ length: 60 }, (_, i): readonly [number, number] => {
  const angle = i * 2.399963;
  const radius = 40 + Math.sqrt((i + 1) / 60) * 440;
  return [Math.round(500 + Math.cos(angle) * radius), Math.round(500 + Math.sin(angle) * radius)];
});
const FLAT_LINKS: readonly number[] = Array.from({ length: 70 }, (_, i) => [i % 60, (i * 7 + 11) % 60]).flat();

const DSM_ENTRIES: readonly (readonly [number, number, number])[] = Array.from({ length: 8 }, (_, from) =>
  [1, 2, 5].map((step, k) => [from, (from + step) % 8, 1 + ((from + k) % 4)] as const),
).flat();

/** The figures with only the heavy marks swapped for the placeholders. */
export function previewFigures(figures: LandingFigures): LandingFigures {
  return {
    ...figures,
    regions: REGIONS,
    arcs: ARCS,
    map: MAP,
    dsm: { ...figures.dsm, n: 8, max: 4, entries: DSM_ENTRIES, blocks: [[0, 3, 1], [3, 3, 2], [6, 2, 1]] },
    flat: { ...figures.flat, points: FLAT_POINTS, links: FLAT_LINKS },
  };
}
