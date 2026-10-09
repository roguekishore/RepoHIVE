"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "./cx";

export type SortDirection = "ascending" | "descending";

export interface SortState {
  readonly key: string;
  readonly direction: SortDirection;
}

export interface TableColumn<Row> {
  readonly key: string;
  readonly header: ReactNode;
  readonly render: (row: Row) => ReactNode;
  /** Right-aligned, in the mono face with tabular figures. */
  readonly numeric?: boolean;
  /** Makes the header a button that calls `onSort` with this column's key. */
  readonly sortable?: boolean;
}

export interface TableProps<Row> {
  /** Names the table for assistive technology. */
  readonly caption: string;
  readonly columns: readonly TableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly sort?: SortState;
  readonly onSort?: (key: string) => void;
  /** Makes rows clickable and focusable; Enter and Space activate. */
  readonly onRowActivate?: (row: Row) => void;
  readonly selectedKey?: string;
  /** Shown instead of the table body when there are no rows. */
  readonly empty?: ReactNode;
}

export function Table<Row>({ caption, columns, rows, rowKey, sort, onSort, onRowActivate, selectedKey, empty }: TableProps<Row>) {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>;

  const activateOnKey = (event: KeyboardEvent, row: Row): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onRowActivate?.(row);
    }
  };

  return (
    <div className="rh-table-wrap">
      <table className="rh-table">
        <caption className="rh-sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => {
              const sorted = sort?.key === column.key ? sort.direction : undefined;
              return (
                <th key={column.key} scope="col" className={cx(column.numeric && "rh-n")} aria-sort={sorted ?? (column.sortable ? "none" : undefined)}>
                  {column.sortable ? (
                    <button type="button" onClick={() => onSort?.(column.key)}>
                      {column.header}
                      {sorted === undefined ? null : <span aria-hidden="true">{sorted === "ascending" ? " ↑" : " ↓"}</span>}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            const activatable = onRowActivate !== undefined;
            return (
              <tr
                key={key}
                className={cx(activatable && "rh-click", selectedKey === key && "rh-on")}
                aria-selected={selectedKey === undefined ? undefined : selectedKey === key}
                tabIndex={activatable ? 0 : undefined}
                onClick={activatable ? () => onRowActivate(row) : undefined}
                onKeyDown={activatable ? (event) => activateOnKey(event, row) : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cx(column.numeric && "rh-n")}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
