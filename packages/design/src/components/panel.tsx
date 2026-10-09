import type { ReactNode } from "react";
import { cx } from "./cx";

export interface PanelProps {
  readonly title?: ReactNode;
  /** Controls at the trailing edge of the header. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  /** Set to false when the content brings its own padding, such as a table. */
  readonly padded?: boolean;
}

/** A bordered surface with an optional header. */
export function Panel({ title, actions, children, className, padded = true }: PanelProps) {
  return (
    <section className={cx("rh-panel", className)}>
      {title === undefined && actions === undefined ? null : (
        <header className="rh-panel-head">
          {title === undefined ? <span /> : <h3>{title}</h3>}
          {actions}
        </header>
      )}
      {padded ? <div className="rh-panel-body">{children}</div> : children}
    </section>
  );
}

export interface KeyValueItem {
  readonly label: ReactNode;
  readonly value: ReactNode;
}

/** A label and value list: the label on the left in the muted colour, the value beside it. */
export function KeyValueList({ items, className }: { readonly items: readonly KeyValueItem[]; readonly className?: string }) {
  return (
    <dl className={cx("rh-kv", className)}>
      {items.map((item, index) => (
        // Labels can repeat across a list, so the position is part of the key.
        <div key={index} className="rh-kv-row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
