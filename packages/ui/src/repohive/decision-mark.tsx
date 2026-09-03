/**
 * The three-state decision encoding, in one place.
 *
 * Every surface that shows a decision uses these, so the language cannot drift
 * between the strip, the scatter, the sunburst, the tables and the legends:
 *
 *   preserve    filled circle   emerald   the authored boundary held
 *   reconstruct hollow diamond  azure     rebuilt from measured dependencies
 *   degenerate  dotted circle   neutral   never assessed — absent data
 *
 * Colour is never the only channel: shape distinguishes all three, and the
 * text label spells the state out. That covers colour-vision deficiency and
 * greyscale printing (paper figures) at once.
 */

import * as React from "react";
import type { DecisionState } from "./types";

export const DECISION_TOKEN: Record<DecisionState, string> = {
  preserve: "var(--color-decision-preserve)",
  reconstruct: "var(--color-decision-reconstruct)",
  degenerate: "var(--color-decision-degenerate)",
};

export const DECISION_LABEL: Record<DecisionState, string> = {
  preserve: "Preserved",
  reconstruct: "Reconstructed",
  degenerate: "Not assessed",
};

/** One line explaining what the state means, for legends and tooltips. */
export const DECISION_GLOSS: Record<DecisionState, string> = {
  preserve: "measured at or above the boundary — the authored package boundary held",
  reconstruct: "measured below the boundary — rebuilt from the dependency structure",
  degenerate: "below the measurable threshold — scored 0 by rule, never assessed",
};

/**
 * The mark as SVG geometry, for use inside a chart's coordinate space.
 * `size` is the mark's radius in user units.
 */
export function DecisionMarkShape({
  state,
  cx,
  cy,
  size,
  className,
}: {
  state: DecisionState;
  cx: number;
  cy: number;
  size: number;
  className?: string;
}) {
  const color = DECISION_TOKEN[state];
  if (state === "preserve") {
    return (
      <circle
        cx={cx}
        cy={cy}
        r={size}
        fill={color}
        fillOpacity={0.85}
        stroke="var(--color-bg-surface)"
        strokeWidth={1}
        className={className}
      />
    );
  }
  if (state === "reconstruct") {
    const r = size + 1;
    return (
      <path
        d={`M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`}
        fill="var(--color-bg-surface)"
        stroke={color}
        strokeWidth={2}
        className={className}
      />
    );
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={Math.max(1, size - 0.5)}
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeDasharray="2.5 3"
      className={className}
    />
  );
}

/** The mark as a standalone inline glyph, for legends, pills and table cells. */
export function DecisionGlyph({ state, size = 12 }: { state: DecisionState; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      aria-hidden="true"
      className="shrink-0 overflow-visible"
    >
      <DecisionMarkShape state={state} cx={11} cy={11} size={7.5} />
    </svg>
  );
}

/**
 * Glyph + word. The word is what makes the distinction survive greyscale, so
 * it is not optional — `compact` shortens it, never removes it.
 */
export function DecisionPill({
  state,
  compact = false,
  title,
}: {
  state: DecisionState;
  compact?: boolean;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]"
      title={title ?? DECISION_GLOSS[state]}
    >
      <DecisionGlyph state={state} size={11} />
      <span
        style={{ color: DECISION_TOKEN[state] }}
        className={state === "degenerate" ? "" : "font-medium"}
      >
        {compact && state === "degenerate" ? "Unassessed" : DECISION_LABEL[state]}
      </span>
    </span>
  );
}

/** The shared three-state legend. */
export function DecisionLegend({
  states = ["preserve", "reconstruct", "degenerate"],
  gloss = false,
  className,
}: {
  states?: readonly DecisionState[];
  gloss?: boolean;
  className?: string;
}) {
  return (
    <ul
      className={`flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-[var(--color-text-tertiary)] ${className ?? ""}`}
    >
      {states.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <DecisionGlyph state={state} size={11} />
          <span style={{ color: DECISION_TOKEN[state] }}>{DECISION_LABEL[state]}</span>
          {gloss && <span className="text-[var(--color-text-tertiary)]">{DECISION_GLOSS[state]}</span>}
        </li>
      ))}
    </ul>
  );
}
