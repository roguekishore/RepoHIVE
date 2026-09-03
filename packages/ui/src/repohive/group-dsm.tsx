"use client";

/**
 * Group DSM — the dependency-structure matrix over the engine's groups.
 *
 * Rows depend on columns: a filled cell (i, j) means group i has recorded
 * dependencies on group j, and the cell's ink tracks the recorded aggregated
 * edge weight. The axis is ordered by the engine's own recorded region and
 * ordinal, so groups belonging to one region sit adjacent and their mutual
 * dependencies form a block on the diagonal. Everything *outside* those blocks
 * is coupling the engine could not localise into a region — which is the point
 * of the artifact.
 *
 * What this deliberately does not show: rule violations and dependency cycles.
 * The vendored `DsmMatrixView` renders both, and we compute neither, so feeding
 * it would have implied a check that never ran. It also defaults a null edge
 * kind to an HTTP transport, which our structural edges are not.
 *
 * Plain CSS grid, no chart dependency. Layout is a pure function of the
 * canonically ordered input.
 */

import * as React from "react";
import { DECISION_TOKEN } from "./decision-mark";
import { middleElide } from "./format";
import type { DecisionState } from "./types";

export type DsmGroupState = DecisionState | "none";

export interface DsmGroupView {
  id: string;
  label: string;
  regionId: string | null;
  state: DsmGroupState;
  level: number;
  files: number;
  outWeight: number;
  inWeight: number;
}

export interface DsmEntryView {
  from: number;
  to: number;
  weight: number;
}

export interface GroupDsmProps {
  groups: readonly DsmGroupView[];
  entries: readonly DsmEntryView[];
  blocks?: ReadonlyArray<{ regionId: string; label: string; start: number; size: number }>;
  maxWeight: number;
  level: number;
  totalGroups: number;
  omittedGroups?: number;
  shownEdges: number;
  totalEdges: number;
}

const CELL = 22;
const HEADER = 132;

const STATE_INK: Record<DsmGroupState, string> = {
  preserve: DECISION_TOKEN.preserve,
  reconstruct: DECISION_TOKEN.reconstruct,
  degenerate: DECISION_TOKEN.degenerate,
  none: "var(--color-text-tertiary)",
};

export function GroupDsm({
  groups,
  entries,
  blocks = [],
  maxWeight,
  level,
  totalGroups,
  omittedGroups = 0,
  shownEdges,
  totalEdges,
}: GroupDsmProps) {
  const [hover, setHover] = React.useState<{ row: number; col: number } | null>(null);

  const cellByKey = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) map.set(`${entry.from}:${entry.to}`, entry.weight);
    return map;
  }, [entries]);

  const blockOf = React.useMemo(() => {
    const map = new Map<number, { label: string; start: number; size: number }>();
    for (const block of blocks) {
      for (let i = block.start; i < block.start + block.size; i++) {
        map.set(i, { label: block.label, start: block.start, size: block.size });
      }
    }
    return map;
  }, [blocks]);

  if (groups.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        This index records no group-to-group dependencies at level {level}.
      </p>
    );
  }

  const n = groups.length;

  return (
    <figure className="m-0">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-text-tertiary)]">
        <span>
          level <strong className="text-[var(--color-text-secondary)]">{level}</strong>
        </span>
        <span>
          <strong className="tabular-nums text-[var(--color-text-secondary)]">{totalGroups}</strong>{" "}
          groups
        </span>
        <span>
          <strong className="tabular-nums text-[var(--color-text-secondary)]">{totalEdges}</strong>{" "}
          recorded dependencies
        </span>
        {omittedGroups > 0 && (
          <span title="The matrix is capped for legibility; the most-connected groups are shown.">
            showing the {n} most-connected ·{" "}
            <strong className="text-[var(--color-text-secondary)]">
              {omittedGroups} groups and {totalEdges - shownEdges} dependencies not drawn
            </strong>
          </span>
        )}
      </div>

      <div className="mt-3 overflow-auto">
        <div
          className="relative"
          style={{
            display: "grid",
            gridTemplateColumns: `${HEADER}px repeat(${n}, ${CELL}px)`,
            gridAutoRows: `${CELL}px`,
            width: "max-content",
          }}
          role="table"
          aria-label={`Dependency-structure matrix over ${n} groups at level ${level}. Rows depend on columns.`}
        >
          {/* Column header strip: rotated labels */}
          <div style={{ gridColumn: 1, gridRow: 1 }} />
          {groups.map((group, col) => (
            <div
              key={`col-${group.id}`}
              style={{ gridColumn: col + 2, gridRow: 1 }}
              className="relative"
              title={`${group.regionId ?? group.id} — ${group.files} files`}
            >
              <span
                className="absolute bottom-0 left-1/2 origin-bottom-left -rotate-90 whitespace-nowrap font-mono text-[9px] text-[var(--color-text-tertiary)]"
                style={{ transformOrigin: "bottom left" }}
              >
                {middleElide(group.label, 16)}
              </span>
            </div>
          ))}

          {groups.map((group, row) => (
            <React.Fragment key={`row-${group.id}`}>
              <div
                style={{ gridColumn: 1, gridRow: row + 2 }}
                className="flex items-center justify-end gap-1.5 overflow-hidden pr-2"
                title={`${group.regionId ?? group.id} — ${group.files} files · out ${group.outWeight} · in ${group.inWeight}`}
              >
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: STATE_INK[group.state] }}
                />
                <span className="truncate font-mono text-[10px] text-[var(--color-text-secondary)]">
                  {middleElide(group.label, 18)}
                </span>
              </div>

              {groups.map((target, col) => {
                const weight = cellByKey.get(`${row}:${col}`) ?? 0;
                const diagonal = row === col;
                const inBlock =
                  !diagonal &&
                  blockOf.get(row) !== undefined &&
                  blockOf.get(row)?.start === blockOf.get(col)?.start;
                const highlighted = hover?.row === row || hover?.col === col;
                const intensity = maxWeight > 0 ? Math.min(1, weight / maxWeight) : 0;
                return (
                  <div
                    key={`${group.id}-${target.id}`}
                    style={{
                      gridColumn: col + 2,
                      gridRow: row + 2,
                      background: diagonal
                        ? `color-mix(in srgb, ${STATE_INK[group.state]} 30%, transparent)`
                        : weight > 0
                          ? `color-mix(in srgb, ${
                              inBlock ? STATE_INK[group.state] : "var(--color-decision-boundary)"
                            } ${Math.round(18 + intensity * 62)}%, transparent)`
                          : inBlock
                            ? "var(--color-bg-elevated)"
                            : "transparent",
                      outline: highlighted ? "1px solid var(--color-border-hover)" : undefined,
                      outlineOffset: "-1px",
                      borderRight: "1px solid var(--color-bg-root)",
                      borderBottom: "1px solid var(--color-bg-root)",
                    }}
                    onMouseEnter={() => setHover({ row, col })}
                    onMouseLeave={() => setHover(null)}
                    title={
                      diagonal
                        ? `${group.label} — ${group.state === "none" ? "no recorded decision" : group.state}`
                        : weight > 0
                          ? `${group.label} → ${target.label} · recorded weight ${weight}`
                          : `${group.label} → ${target.label} · no recorded dependency`
                    }
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      <figcaption className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
        Rows depend on columns; ink tracks the recorded aggregated edge weight. The axis is ordered
        by the engine&rsquo;s recorded region and ordinal, so one region&rsquo;s groups sit adjacent
        and their mutual dependencies form a block on the diagonal — cells in the boundary colour
        outside those blocks are the coupling that crosses regions. Cycles and rule violations are
        not shown because the engine does not record them.
      </figcaption>
    </figure>
  );
}
