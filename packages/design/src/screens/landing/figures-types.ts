/**
 * The shape of the figures the landing page shows. They are produced by `packages/design/scripts/landing-figures.mjs`
 * from a real index, so no number on the landing is typed by hand. Rows are tuples to keep the committed
 * file small; each is documented where it is declared.
 */

/** 1 kept (preserve), 2 rebuilt (reconstruct). Unassessed regions are not in the region list. */
export type RegionDecisionCode = 1 | 2;

/** 0 no decision (a wrapper group above the regions), 1 kept, 2 rebuilt, 3 unassessed. */
export type ArcKindCode = 0 | 1 | 2 | 3;

/** name (without the package prefix), files, cohesion, coupling, score, decision, groups the region was split into. */
export type RegionRow = readonly [name: string, files: number, cohesion: number, coupling: number, score: number, decision: RegionDecisionCode, groups: number];

/** ring (1 is innermost), start and span in turns clockwise from twelve o'clock, files below it, kind. */
export type ArcRow = readonly [ring: number, start: number, span: number, files: number, kind: ArcKindCode];

/** parent position (-1 for the root), files below it, rank among its siblings, kind. */
export type MapRow = readonly [parent: number, files: number, rank: number, kind: ArcKindCode];

export interface LandingFigures {
  readonly repository: string;
  readonly indexFormatVersion: number;
  /** Every region name shares this package prefix; the page shows names without it. */
  readonly namePrefix: string;
  readonly counts: {
    readonly files: number;
    /** Hierarchy nodes: `repository.json`'s `nodeCount`. */
    readonly nodes: number;
    /** Files, classes and functions. */
    readonly leafNodes: number;
    readonly groupNodes: number;
    /** `repository.json`'s `edgeCount`: file-level plus between-group dependencies. */
    readonly edges: number;
    readonly leafEdges: number;
    readonly crossGroupEdges: number;
    readonly depth: number;
    readonly regions: number;
    readonly assessed: number;
    readonly preserved: number;
    readonly reconstructed: number;
    /** Regions too small to measure: score and cohesion both recorded as zero. */
    readonly degenerate: number;
    /** Kept share of the measured regions, as the views package records it. */
    readonly preserveShare: number;
  };
  /** The parser signal level the split was taken at (the split moves with it; never quote it without this). */
  readonly signal: {
    readonly imports: number;
    readonly calls: number;
    readonly sharedTypes: number;
    /** The signals the file-level edges carry, in words: "imports and shared types, with no method calls". */
    readonly level: string;
  };
  readonly settings: {
    readonly boundary: number;
    readonly cohesionWeight: number;
    readonly couplingWeight: number;
    readonly squash: number;
    readonly seed: number;
    readonly maxGroupSize: number;
    readonly importCoefficient: number;
    readonly callCoefficient: number;
    readonly sharedTypeCoefficient: number;
  };
  /** The measured regions (alphabetical), each with its recorded decision. */
  readonly regions: readonly RegionRow[];
  /** The regions the film follows. */
  readonly featured: { readonly kept: readonly string[]; readonly rebuilt: string };
  /** Four groups of the rebuilt featured region: a shortened id, files, and one file's name. */
  readonly zoom: {
    readonly region: string;
    readonly groups: readonly { readonly id: string; readonly files: number; readonly sample: string }[];
  };
  readonly arcs: readonly ArcRow[];
  readonly dsm: {
    /** Groups on each axis. */
    readonly n: number;
    /** The heaviest recorded dependency, for scaling cell opacity. */
    readonly max: number;
    /** from, to, weight. */
    readonly entries: readonly (readonly [number, number, number])[];
    /** start, size, kind: a run of groups of one region along the axis. */
    readonly blocks: readonly (readonly [number, number, ArcKindCode])[];
    readonly level: number;
    readonly totalGroups: number;
    readonly omittedGroups: number;
  };
  /** Repository and groups down to level 3: the map's containment tree. */
  readonly map: readonly MapRow[];
  readonly flat: {
    /** One seeded layout position per file in a 1000 by 1000 square. */
    readonly points: readonly (readonly [number, number])[];
    /** Pairs of file positions (a flat list) for every `stride`-th file dependency. */
    readonly links: readonly number[];
    readonly stride: number;
    readonly totalLinks: number;
    readonly seed: number;
  };
  readonly determinism: {
    readonly groupScheme: string;
    readonly sampleGroupId: string;
    readonly sampleMembers: number;
    /** The `group` digest of the determinism gate, over this index. */
    readonly digest: string;
    readonly files: readonly { readonly name: string; readonly bytes: number; readonly sha256: string }[];
  };
}
