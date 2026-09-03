/**
 * Provenance card — one region's decision shown as the worked calculation,
 * not just the verdict (handoff §9 idea 3).
 *
 * Every input row is a recorded engine value rendered exactly (`String(v)`,
 * no rounding). Derived rows re-apply the engine's own recorded formula and
 * are marked with ≈; when the recomputation cannot reproduce the recorded
 * score (the engine's degenerate-region rule, or a modularity weight), the
 * card says so and the recorded value stays authoritative.
 */

import * as React from "react";
import { independenceOf, recomputeScore, squashCohesion } from "./decision-model";
import { DecisionPill } from "./decision-mark";
import { displayNumber } from "./format";
import type { DecisionWeights, RegionView } from "./types";

export interface ProvenanceGroupLink {
  id: string;
  label: string;
  href: string;
}

export interface ProvenanceCardProps {
  region: RegionView;
  weights: DecisionWeights;
  squashK: number;
  /** The recorded boundary the decision was made against. */
  recordedBoundary: number;
  /** The boundary currently applied by the slider, when it differs. */
  counterfactualBoundary?: number | null;
  /** Community-detection seed, when the index recorded its configuration. */
  seed?: number | null;
  /** The groups this decision produced, as ready-made links into the map. */
  groups?: readonly ProvenanceGroupLink[];
  LinkComponent?: React.ComponentType<{
    href: string;
    className?: string;
    children: React.ReactNode;
  }>;
}

/** A recorded value, rendered exactly as recorded. */
function Exact({ value }: { value: number }) {
  return <span className="font-mono tabular-nums">{String(value)}</span>;
}

/** A value derived by re-applying the engine's recorded formula. */
function Derived({ value }: { value: number }) {
  return <span className="font-mono tabular-nums">≈{value.toFixed(3)}</span>;
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-[var(--color-border-default)] py-1.5 first:border-t-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
        {label}
      </span>
      <span className="text-right text-[13px] text-[var(--color-text-primary)]">{children}</span>
    </div>
  );
}

export function ProvenanceCard({
  region,
  weights,
  squashK,
  recordedBoundary,
  counterfactualBoundary,
  seed,
  groups = [],
  LinkComponent,
}: ProvenanceCardProps) {
  const Link = LinkComponent ?? ((p) => <a href={p.href} className={p.className}>{p.children}</a>);
  const cohesionNorm = squashCohesion(region.cohesion, squashK);
  const independence = independenceOf(region.coupling);
  const recomputed = recomputeScore(region.cohesion, region.coupling, squashK, weights);
  const reproduces = recomputed !== null && Math.abs(recomputed - region.score) < 5e-4;
  const preserved = region.action === "preserve";
  const counterfactual =
    counterfactualBoundary != null && Math.abs(counterfactualBoundary - recordedBoundary) > 1e-9;

  return (
    <aside
      aria-label={`Decision provenance for ${region.label}`}
      className="rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4"
    >
      <header className="mb-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
          decision provenance
        </p>
        <h3
          className="mt-0.5 break-all font-mono text-[15px] leading-snug text-[var(--color-text-primary)]"
          title={region.regionId}
        >
          {region.label}
        </h3>
        <p className="mt-1.5 text-[13px]">
          <DecisionPill state={region.recordedState} />{" "}
          <span className="text-[var(--color-text-secondary)]">
            —{" "}
            {region.degenerate
              ? "below the measurable threshold; reconstructed by rule without assessment"
              : preserved
                ? "package boundary kept as authored"
                : "regrouped by dependency clustering"}
          </span>
        </p>
      </header>

      <div>
        <Row label="cohesion, recorded">
          <Exact value={region.cohesion} />
        </Row>
        <Row label={`squashed c∕(c+${String(squashK)})`}>
          <Derived value={cohesionNorm} />
        </Row>
        <Row label="coupling, recorded">
          <Exact value={region.coupling} />
        </Row>
        <Row label="independence 1−coupling">
          <Derived value={independence} />
        </Row>
        <Row label={`weights ${String(weights.cohesion)} ∕ ${String(weights.coupling)}${weights.modularity !== undefined ? ` ∕ ${String(weights.modularity)} (Q)` : ""}`}>
          {recomputed !== null ? <Derived value={recomputed} /> : <span className="text-[var(--color-text-tertiary)]">blend not reproducible here</span>}
        </Row>
        <Row label="score, recorded">
          <Exact value={region.score} />
        </Row>
        {!reproduces && recomputed !== null && (
          <p className="border-t border-[var(--color-border-default)] py-1.5 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
            The recorded score differs from the re-applied formula — the engine&rsquo;s
            degenerate-region rule assigned this score directly.
          </p>
        )}
        <Row label={`vs boundary ${String(recordedBoundary)}`}>
          <span className="font-mono tabular-nums">
            {String(region.score)} {region.score >= recordedBoundary ? "≥" : "<"} {String(recordedBoundary)}
          </span>{" "}
          → {region.automaticAction}
        </Row>
        <Row label="confidence |score−boundary|">
          {region.degenerate ? (
            <span
              className="text-[var(--color-decision-degenerate)]"
              title={`The index records ${String(region.decisionConfidence)}, but it is arithmetic over a rule-assigned score, not a measurement.`}
            >
              not measured
            </span>
          ) : (
            <Exact value={region.decisionConfidence} />
          )}
        </Row>
        {region.userOverridden && (
          <p className="border-t border-[var(--color-border-default)] py-1.5 text-[11px] leading-relaxed text-[var(--color-warning)]">
            Overridden by configuration: applied action is {region.action}, measured action was{" "}
            {region.automaticAction}.
          </p>
        )}
        {counterfactual && region.flipped && (
          <p className="border-t border-[var(--color-border-default)] py-1.5 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
            At the slider&rsquo;s boundary of {displayNumber(counterfactualBoundary!)} this region would
            flip to <strong>{region.effectiveAction}</strong>.
          </p>
        )}
        <Row label="files in region">
          <Exact value={region.fileCount} />
        </Row>
        {seed != null && (
          <Row label="community-detection seed">
            <Exact value={seed} />
          </Row>
        )}
      </div>

      {groups.length > 0 && (
        <footer className="mt-3 border-t border-[var(--color-border-default)] pt-2.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
            groups produced ({groups.length})
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {groups.map((group) => (
              <li key={group.id}>
                <Link
                  href={group.href}
                  className="inline-block rounded border border-[var(--color-border-default)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-active)] hover:text-[var(--color-accent-primary)]"
                >
                  {group.label} ↗
                </Link>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </aside>
  );
}
