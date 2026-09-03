/**
 * Fragmentation — one authored package in, N dependency clusters out.
 *
 * This is the evidence that an authored boundary was misleading: the author
 * declared these files a single unit, and the recorded dependencies say they
 * are several unrelated ones. Each row is one region; each segment is one group
 * the engine produced, sized by the files it holds.
 *
 * It deliberately reads this direction and not the other. A region *is* an
 * authored package and reconstruction partitions strictly within one, so a
 * produced group can never mix packages — charting packages→groups as a mixing
 * flow would assert something the engine cannot produce. Splitting is what it
 * does produce, so splitting is what this shows.
 *
 * Pure presentation, zero chart dependencies. Rows arrive ordered.
 */

import * as React from "react";
import { DECISION_TOKEN } from "./decision-mark";
import { displayNumber, middleElide } from "./format";

export interface FragmentedRegionView {
  regionId: string;
  label: string;
  files: number;
  groupCount: number;
  groupSizes: number[];
  largestShare: number;
  score: number;
}

export interface FragmentationProps {
  regions: readonly FragmentedRegionView[];
  totalReconstructed: number;
  omittedRegions?: number;
  maxSplit: number;
}

export function Fragmentation({
  regions,
  totalReconstructed,
  omittedRegions = 0,
  maxSplit,
}: FragmentationProps) {
  if (regions.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        No measured region was split into more than one group in this index, so there is no
        fragmentation to show.
      </p>
    );
  }

  // Rows share one horizontal scale so a wide package reads as wide.
  const widest = regions.reduce((m, r) => Math.max(m, r.files), 0) || 1;

  return (
    <figure className="m-0">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-text-tertiary)]">
        <span>
          <strong className="tabular-nums text-[var(--color-text-secondary)]">
            {totalReconstructed}
          </strong>{" "}
          measured regions were split
        </span>
        <span>
          worst case{" "}
          <strong className="tabular-nums text-[var(--color-text-secondary)]">{maxSplit}</strong>{" "}
          clusters from one package
        </span>
        {omittedRegions > 0 && (
          <span>
            showing the {regions.length} most fragmented ·{" "}
            <strong className="text-[var(--color-text-secondary)]">
              {omittedRegions} not shown
            </strong>
          </span>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {regions.map((region) => (
          <li key={region.regionId} className="grid grid-cols-1 gap-x-4 sm:grid-cols-[210px_minmax(0,1fr)]">
            <div className="min-w-0">
              <p
                className="truncate font-mono text-xs text-[var(--color-text-primary)]"
                title={region.regionId}
              >
                {middleElide(region.label, 30)}
              </p>
              <p className="text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
                {region.files} files → {region.groupCount} clusters · score{" "}
                {displayNumber(region.score)}
              </p>
            </div>

            <div className="min-w-0 self-center">
              <div
                className="flex h-4 gap-[2px]"
                style={{ width: `${Math.max(12, (region.files / widest) * 100)}%` }}
                role="img"
                aria-label={`${region.label}: ${region.files} authored files split into ${region.groupCount} clusters of ${region.groupSizes.join(", ")} files`}
              >
                {region.groupSizes.map((size, i) => (
                  <div
                    key={`${region.regionId}-${i}`}
                    title={`cluster ${i + 1}: ${size} file${size === 1 ? "" : "s"}`}
                    className="h-full rounded-[2px]"
                    style={{
                      flexGrow: size,
                      flexBasis: 0,
                      minWidth: 2,
                      background: DECISION_TOKEN.reconstruct,
                      // Later clusters recede, so the split reads left-to-right
                      // from the dominant cluster to the fragments.
                      opacity: Math.max(0.3, 0.9 - i * 0.06),
                    }}
                  />
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <figcaption className="mt-3 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
        Each bar is one authored package; each segment is a group the dependencies produced, sized by
        the files it holds. Bar width compares packages by size. Only measured regions appear —
        regions scored by rule were never assessed, so their split says nothing about structure.
      </figcaption>
    </figure>
  );
}
