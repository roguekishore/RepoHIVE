/**
 * Per-level flow — how the hierarchy narrows from files to the repository.
 *
 * `perLevel[]` is recorded per level and needs no derivation: group nodes,
 * leaves, cross-group edges and leaf edges, exactly as the engine counted them.
 * Bars are scaled to the largest value in each column so the shape of the
 * hierarchy is readable across three orders of magnitude, and every number is
 * printed beside its bar so the scaling never has to be trusted.
 *
 * Pure presentation. Rows arrive in level order.
 */

import * as React from "react";

export interface LevelFlowRowData {
  level: number;
  groupNodeCount: number;
  leafNodeCount: number;
  crossGroupEdgeCount: number;
  leafEdgeCount: number;
}

const COLUMNS = [
  {
    key: "groupNodeCount" as const,
    label: "Group nodes",
    hint: "containers the engine created at this level",
    color: "var(--color-decision-reconstruct)",
  },
  {
    key: "leafNodeCount" as const,
    label: "Leaves",
    hint: "files, classes and functions living at this level",
    color: "var(--color-text-secondary)",
  },
  {
    key: "crossGroupEdgeCount" as const,
    label: "Cross-group edges",
    hint: "aggregated dependencies between siblings at this level",
    color: "var(--color-decision-boundary)",
  },
  {
    key: "leafEdgeCount" as const,
    label: "Leaf edges",
    hint: "the original dependency edges, all at the leaf level",
    color: "var(--color-text-tertiary)",
  },
];

export function LevelFlow({ rows }: { rows: readonly LevelFlowRowData[] }) {
  const maxima = React.useMemo(() => {
    const out = {} as Record<(typeof COLUMNS)[number]["key"], number>;
    for (const column of COLUMNS) {
      out[column.key] = rows.reduce((m, row) => Math.max(m, row[column.key]), 0);
    }
    return out;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        This index records no per-level statistics.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <caption className="sr-only">
          Per-level counts of group nodes, leaves, cross-group edges and leaf edges, as recorded.
        </caption>
        <thead>
          <tr className="border-b border-[var(--color-border-active)]">
            <th
              scope="col"
              className="px-2 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]"
            >
              Level
            </th>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                title={column.hint}
                className="px-2 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.level} className="border-b border-[var(--color-border-default)]">
              <th
                scope="row"
                className="whitespace-nowrap px-2 py-2 text-left font-mono text-xs tabular-nums text-[var(--color-text-primary)]"
              >
                L{row.level}
                {row.level === 0 && (
                  <span className="ml-1.5 text-[10px] text-[var(--color-text-tertiary)]">
                    repository
                  </span>
                )}
              </th>
              {COLUMNS.map((column) => {
                const value = row[column.key];
                const max = maxima[column.key] || 1;
                return (
                  <td key={column.key} className="px-2 py-2 align-middle">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-full min-w-[40px] max-w-[130px] overflow-hidden rounded-sm bg-[var(--color-bg-inset)]">
                        <div
                          className="h-full rounded-sm"
                          style={{
                            width: value === 0 ? "0%" : `${Math.max(1.5, (value / max) * 100)}%`,
                            background: column.color,
                            opacity: value === 0 ? 0 : 0.8,
                          }}
                        />
                      </div>
                      <span
                        className={`shrink-0 font-mono text-xs tabular-nums ${
                          value === 0
                            ? "text-[var(--color-text-tertiary)]"
                            : "text-[var(--color-text-primary)]"
                        }`}
                      >
                        {value === 0 ? "—" : value.toLocaleString()}
                      </span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
        Bars are scaled per column, so lengths compare down a column and not across the table; the
        recorded count is printed beside each one. Every value is read from{" "}
        <code className="font-mono">metadata.perLevel</code>.
      </p>
    </div>
  );
}
