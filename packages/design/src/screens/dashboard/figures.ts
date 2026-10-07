/**
 * The figures a repository card shows beyond the list's own fields. They are read from the snapshot's `adaptivity`
 * view, which the engine's recorded decisions feed: for a hosted snapshot it holds one entry, the repository itself.
 * Nothing here is computed from anything else; an absent field is an absent figure.
 */
import type { SizeTier, ViewBodies } from "../../contracts";

export interface RepoFigures {
  /** Java files in the index. */
  readonly files: number;
  readonly regions: number;
  /** Regions the engine measured. The kept and rebuilt counts are of these only. */
  readonly assessed: number;
  readonly preserved: number;
  readonly reconstructed: number;
  /** Regions scored by rule and never assessed. */
  readonly degenerate: number;
  /** The engine's preserved / assessed; `null` when nothing was assessed. */
  readonly preserveShare: number | null;
}

const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/** The one repository entry of an adaptivity view, or `undefined` when the body is not the shape the engine writes. */
export function figuresFromAdaptivity(view: ViewBodies["adaptivity"]): RepoFigures | undefined {
  const repos: readonly unknown[] = Array.isArray((view as { repos?: unknown } | undefined)?.repos)
    ? (view as { repos: unknown[] }).repos
    : [];
  const entry = repos[0];
  if (typeof entry !== "object" || entry === null) return undefined;
  const record = entry as Record<string, unknown>;
  const files = count(record.files);
  const regions = count(record.regions);
  const assessed = count(record.assessed);
  const preserved = count(record.preserved);
  const reconstructed = count(record.reconstructed);
  const degenerate = count(record.degenerate);
  if (
    files === undefined ||
    regions === undefined ||
    assessed === undefined ||
    preserved === undefined ||
    reconstructed === undefined ||
    degenerate === undefined
  ) {
    return undefined;
  }
  const share = record.preserveShare;
  return {
    files,
    regions,
    assessed,
    preserved,
    reconstructed,
    degenerate,
    preserveShare: typeof share === "number" && Number.isFinite(share) ? share : null,
  };
}

/**
 * Most selected Java files each size class takes: the indexer's `TIER_MAX_FILES`, which `figures.test.ts` pins. The
 * dashboard's size chips use it to name the class a recorded file count falls in.
 */
export const SIZE_MAX_FILES: Readonly<Record<SizeTier, number>> = { S: 1_000, M: 5_000, L: 15_000, XL: 30_000 };

/** The smallest class whose cap holds `files`; XL for anything above, since a larger repository is never indexed. */
export function sizeClassForFiles(files: number): SizeTier {
  if (files <= SIZE_MAX_FILES.S) return "S";
  if (files <= SIZE_MAX_FILES.M) return "M";
  if (files <= SIZE_MAX_FILES.L) return "L";
  return "XL";
}

/** Whole percent of the engine's `preserveShare`, for the card's "kept" figure. */
export function keptPercent(figures: RepoFigures): number | undefined {
  return figures.preserveShare === null ? undefined : Math.round(figures.preserveShare * 100);
}
