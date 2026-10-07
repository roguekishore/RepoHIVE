import type { ElementType, ReactNode } from "react";
import type { TextRole } from "../tokens/names";
import { cx } from "./cx";

export interface AlertProps {
  readonly tone?: "err" | "warn" | "info";
  readonly title?: ReactNode;
  readonly children?: ReactNode;
}

/** A boxed message with a coloured left edge. Errors announce themselves; the others are read in order. */
export function Alert({ tone = "err", title, children }: AlertProps) {
  return (
    <div className={cx("rh-alert", tone !== "err" && `rh-alert-${tone}`)} role={tone === "err" ? "alert" : undefined}>
      {title === undefined ? null : <strong>{title}</strong>}
      {children === undefined ? null : <span className="rh-fg2">{children}</span>}
    </div>
  );
}

export interface EmptyStateProps {
  readonly title: ReactNode;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}

/** What a list or view shows when it has nothing: say why, and what to do next. */
export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className="rh-empty">
      <span className="rh-t-lead rh-fg2">{title}</span>
      {children === undefined ? null : <span className="rh-t-caption">{children}</span>}
      {action}
    </div>
  );
}

export interface TextProps {
  readonly role: TextRole;
  readonly as?: ElementType;
  readonly tone?: "default" | "muted" | "subtle" | "accent" | "err";
  /** The mono face with tabular figures, for numbers. */
  readonly figure?: boolean;
  readonly className?: string;
  /** A tooltip, for text shown in a shortened form. */
  readonly title?: string;
  readonly children: ReactNode;
}

/** Text in one of the eight type roles. There is no other way to choose a size. */
export function Text({ role, as: Tag = "span", tone = "default", figure = false, className, title, children }: TextProps) {
  return (
    <Tag title={title} className={cx(`rh-t-${role}`, tone !== "default" && `rh-tone-${tone}`, figure && "rh-fig", className)}>
      {children}
    </Tag>
  );
}

/** The page column: padded, centred, capped in width. */
export function Page({ narrow = false, children }: { readonly narrow?: boolean; readonly children: ReactNode }) {
  return <div className={cx("rh-page", narrow && "rh-page-narrow")}>{children}</div>;
}
