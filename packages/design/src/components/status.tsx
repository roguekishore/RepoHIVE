import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * What the engine decided for a region. `unassessed` is a region that was never assessed: it is neither kept nor
 * rebuilt, and it must not be drawn as either.
 */
export type Decision = "kept" | "rebuilt" | "unassessed";

const DECISION_LABEL: Record<Decision, string> = {
  kept: "Kept",
  rebuilt: "Rebuilt",
  unassessed: "Unassessed",
};

/**
 * The shape alone: a solid outline for kept, a dashed outline in the rebuilt colour for rebuilt, a filled neutral cell
 * for unassessed. The shape differs as well as the colour, so the decision never depends on colour. Decoration only;
 * pair it with text or use {@link DecisionTag}.
 */
export function DecisionGlyph({ decision }: { readonly decision: Decision }) {
  return <span className={cx("rh-glyph", `rh-glyph-${decision}`)} aria-hidden="true" />;
}

/** The glyph and its word. */
export function DecisionTag({ decision, children }: { readonly decision: Decision; readonly children?: ReactNode }) {
  return (
    <span className="rh-tag">
      <DecisionGlyph decision={decision} />
      {children ?? DECISION_LABEL[decision]}
    </span>
  );
}

export type StatusTone = "ok" | "run" | "warn" | "err" | "idle";

/** A coloured dot. The meaning is in `label`, which is read aloud and shown beside it by {@link StatusTag}. */
export function StatusDot({ tone, label }: { readonly tone: StatusTone; readonly label?: string }) {
  return (
    <span className={cx("rh-dot", `rh-st-${tone}`)} role={label === undefined ? undefined : "img"} aria-label={label} aria-hidden={label === undefined ? true : undefined} />
  );
}

/** A dot and the word for the status. */
export function StatusTag({ tone, children }: { readonly tone: StatusTone; readonly children: ReactNode }) {
  return (
    <span className="rh-tag">
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

export type BarSegmentKind = "kept" | "rebuilt" | "unassessed" | "progress";

export interface BarSegment {
  readonly kind: BarSegmentKind;
  readonly value: number;
}

export interface SplitBarProps {
  readonly segments: readonly BarSegment[];
  /** What the bar says, in words: it is an image to assistive technology. */
  readonly label: string;
  readonly className?: string;
}

/** A proportional bar, for the kept and rebuilt split or a progress fraction. Widths come from the values as given. */
export function SplitBar({ segments, label, className }: SplitBarProps) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  return (
    <div className={cx("rh-bar", className)} role="img" aria-label={label}>
      {segments.map((segment) =>
        total === 0 || segment.value <= 0 ? null : (
          <i key={segment.kind} className={`rh-bar-${segment.kind}`} style={{ width: `${(segment.value / total) * 100}%` }} />
        ),
      )}
    </div>
  );
}

export interface MeterProps {
  readonly value: number;
  readonly max: number;
  readonly label: string;
}

/** A thin usage meter, such as the day's index requests. */
export function Meter({ value, max, label }: MeterProps) {
  const fraction = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  return (
    <span className="rh-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <i style={{ width: `${fraction * 100}%` }} />
    </span>
  );
}
