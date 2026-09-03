/**
 * Determinism panel — the reproducibility claim, shown rather than asserted.
 *
 * Group identifiers are content-addressed: `g_` followed by the SHA-1 of the
 * JSON of the group's member ids in canonical order. Nothing about the id comes
 * from a counter, a timestamp, iteration order or randomness, so the same
 * membership always produces the same id, and a different membership produces a
 * different one.
 *
 * That is why re-running the engine on unchanged input yields a byte-identical
 * index — and why this viewer can be used for paper figures. The panel shows
 * real ids beside the membership they hash over, plus the recorded run
 * configuration a reader would need to reproduce them.
 */

import * as React from "react";
import { middleElide } from "./format";

export interface DeterminismSample {
  id: string;
  regionId: string | null;
  memberCount: number;
  members: string[];
}

export interface DeterminismPanelProps {
  scheme: string;
  repositoryId: string;
  samples: readonly DeterminismSample[];
  totalGroups: number;
  distinctIds: number;
  seed: number | null;
  configuration: {
    structuralQualityBoundary?: number;
    communityDetectionSeed?: number;
    weightCoefficients?: {
      importCoefficient: number;
      callCoefficient: number;
      sharedTypeCoefficient: number;
    };
    assessment?: {
      weights: { cohesion: number; coupling: number; modularity?: number };
      computeModularity: boolean;
      cohesionSquashConstant: number;
      degenerateScore: number;
    };
    hierarchy?: { maxGroupSize: number; minPartitionThreshold: number };
    overrides?: Record<string, string>;
  } | null;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-[var(--color-border-default)] py-1.5 first:border-t-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
        {label}
      </dt>
      <dd className="font-mono text-xs tabular-nums text-[var(--color-text-primary)]">{children}</dd>
    </div>
  );
}

export function DeterminismPanel({
  scheme,
  repositoryId,
  samples,
  totalGroups,
  distinctIds,
  seed,
  configuration,
}: DeterminismPanelProps) {
  const overrides = configuration?.overrides ?? {};
  const overrideCount = Object.keys(overrides).length;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section aria-label="Content-addressed identifiers">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Identifiers are derived from content
        </h3>
        <p className="mt-1 max-w-[62ch] text-xs leading-relaxed text-[var(--color-text-secondary)]">
          A group&rsquo;s id is <code className="font-mono">{scheme}</code> — no counter, no
          timestamp, no iteration order, no randomness. The same membership therefore always yields
          the same id, which is what makes a re-run byte-identical.
        </p>

        <ul className="mt-3 space-y-2.5">
          {samples.map((sample) => (
            <li
              key={sample.id}
              className="rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-2.5"
            >
              <p
                className="font-mono text-xs text-[var(--color-text-primary)]"
                title={sample.id}
              >
                {middleElide(sample.id, 30)}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                {sample.regionId ? (
                  <span title={sample.regionId}>{middleElide(sample.regionId, 34)} · </span>
                ) : (
                  <span>no region · </span>
                )}
                <span className="tabular-nums">{sample.memberCount}</span> member
                {sample.memberCount === 1 ? "" : "s"} hashed in canonical order
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {sample.members.map((member) => (
                  <li
                    key={member}
                    className="font-mono text-[10px] text-[var(--color-text-secondary)]"
                    title={member}
                  >
                    {middleElide(member, 40)}
                  </li>
                ))}
                {sample.memberCount > sample.members.length && (
                  <li className="text-[10px] text-[var(--color-text-tertiary)]">
                    …and {sample.memberCount - sample.members.length} more
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ul>

        <p className="mt-2.5 text-[11px] text-[var(--color-text-tertiary)]">
          <span className="tabular-nums text-[var(--color-text-secondary)]">{distinctIds}</span>{" "}
          distinct ids across{" "}
          <span className="tabular-nums text-[var(--color-text-secondary)]">{totalGroups}</span>{" "}
          groups
          {distinctIds === totalGroups
            ? " — every group's membership hashed uniquely in this run."
            : " — fewer distinct ids than groups would mean two groups share a membership."}
        </p>
      </section>

      <section aria-label="Recorded run configuration">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          The run records its own recipe
        </h3>
        <p className="mt-1 max-w-[62ch] text-xs leading-relaxed text-[var(--color-text-secondary)]">
          Everything needed to reproduce this index is in the artifact itself, so a reader does not
          have to trust the numbers on the other surfaces — they can re-run the engine with these
          values and compare.
        </p>

        {configuration ? (
          <dl className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2">
            <Fact label="repository id">
              <span title={repositoryId}>{middleElide(repositoryId, 26)}</span>
            </Fact>
            {configuration.structuralQualityBoundary !== undefined && (
              <Fact label="quality boundary">{String(configuration.structuralQualityBoundary)}</Fact>
            )}
            {seed !== null && <Fact label="community seed">{String(seed)}</Fact>}
            {configuration.assessment && (
              <>
                <Fact label="metric weights">
                  cohesion {String(configuration.assessment.weights.cohesion)} · coupling{" "}
                  {String(configuration.assessment.weights.coupling)}
                  {configuration.assessment.weights.modularity !== undefined && (
                    <> · modularity {String(configuration.assessment.weights.modularity)}</>
                  )}
                </Fact>
                <Fact label="cohesion squash k">
                  {String(configuration.assessment.cohesionSquashConstant)}
                </Fact>
                <Fact label="degenerate score">
                  {String(configuration.assessment.degenerateScore)}
                </Fact>
                <Fact label="modularity computed">
                  {configuration.assessment.computeModularity ? "yes" : "no"}
                </Fact>
              </>
            )}
            {configuration.weightCoefficients && (
              <Fact label="edge coefficients">
                import {String(configuration.weightCoefficients.importCoefficient)} · call{" "}
                {String(configuration.weightCoefficients.callCoefficient)} · shared type{" "}
                {String(configuration.weightCoefficients.sharedTypeCoefficient)}
              </Fact>
            )}
            {configuration.hierarchy && (
              <Fact label="hierarchy bounds">
                max group {String(configuration.hierarchy.maxGroupSize)} · min partition{" "}
                {String(configuration.hierarchy.minPartitionThreshold)}
              </Fact>
            )}
            <Fact label="manual overrides">
              {overrideCount === 0
                ? "none — every decision below is the algorithm's own"
                : `${overrideCount} region${overrideCount === 1 ? "" : "s"} overridden`}
            </Fact>
          </dl>
        ) : (
          <p className="mt-3 text-xs text-[var(--color-decision-degenerate)]">
            This index predates the recorded-configuration field, so the run&rsquo;s parameters are
            not available here.
          </p>
        )}
      </section>
    </div>
  );
}
