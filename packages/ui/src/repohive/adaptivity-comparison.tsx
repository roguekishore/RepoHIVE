/**
 * Adaptivity comparison — the cross-repository evidence, as pure presentation.
 *
 * The thesis in one screen: the same algorithm, the same weights, the same
 * boundary and the same seed produce materially different preserve rates on
 * different repositories. If the engine applied one policy everywhere, these
 * rates would match.
 *
 * Two honesty rules are structural here, not stylistic:
 *
 *  1. The rate is computed over **assessed regions only**. Folding
 *     rule-assigned reconstructions into the denominator would make every
 *     repository look like it always reconstructs, which is precisely the
 *     misreading this surface exists to prevent — so the unassessed count is
 *     always stated beside the rate rather than hidden in it.
 *  2. The comparison only claims to be controlled when the runs actually share
 *     a configuration. `sameConfiguration === false` replaces the claim with
 *     the caveat.
 *
 * Props in, no fetching, no clock, no RNG. Repos arrive in the caller's
 * canonical order and are rendered in it.
 */

import * as React from "react";
import { DECISION_TOKEN, DecisionLegend } from "./decision-mark";
import { displayNumber, displayPercent } from "./format";

export interface AdaptivityRepoView {
  id: string;
  name: string;
  files: number;
  nodes: number;
  edges: number;
  depth: number;
  regions: number;
  assessed: number;
  preserved: number;
  reconstructed: number;
  degenerate: number;
  preserveShare: number | null;
  config: {
    boundary: number;
    weights: { cohesion: number; coupling: number; modularity?: number };
    squashK: number;
    seed: number | null;
    maxGroupSize: number | null;
    minPartitionThreshold: number | null;
  };
  /** Recorded scores of the assessed regions, ascending. */
  assessedScores: number[];
}

export interface AdaptivityComparisonProps {
  repos: readonly AdaptivityRepoView[];
  sameConfiguration: boolean;
  configurationNote?: string | null;
  /** Registered repositories with no index on this machine. */
  skipped?: readonly string[];
}

/** One repository: scale on the left, the assessed-only rate on the right. */
function RateRow({ repo, maxFiles }: { repo: AdaptivityRepoView; maxFiles: number }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-[var(--color-border-default)] py-4 sm:grid-cols-[190px_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="truncate font-mono text-[13px] text-[var(--color-text-primary)]">
          {repo.name}
        </p>
        <p className="mt-0.5 text-[11px] tabular-nums text-[var(--color-text-tertiary)]">
          {repo.files.toLocaleString()} files · {repo.nodes.toLocaleString()} nodes · depth{" "}
          {repo.depth}
        </p>
        <div className="mt-1.5 h-0.5 w-full max-w-[150px] overflow-hidden rounded bg-[var(--color-bg-inset)]">
          <div
            className="h-full bg-[var(--color-text-tertiary)]"
            style={{ width: `${Math.max(2, (repo.files / maxFiles) * 100)}%` }}
          />
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <span
            className="text-2xl font-semibold tabular-nums"
            style={{ color: DECISION_TOKEN.preserve }}
          >
            {displayPercent(repo.preserveShare)}
          </span>
          <span className="text-xs text-[var(--color-text-secondary)]">
            of assessed regions preserved
            <span className="ml-1.5 tabular-nums text-[var(--color-text-tertiary)]">
              ({repo.preserved} of {repo.assessed})
            </span>
          </span>
        </div>

        {repo.assessed > 0 ? (
          <div
            className="mt-2 flex h-2.5 w-full overflow-hidden rounded-sm"
            role="img"
            aria-label={`${repo.preserved} of ${repo.assessed} assessed regions preserved`}
          >
            <div
              style={{
                width: `${(repo.preserved / repo.assessed) * 100}%`,
                background: DECISION_TOKEN.preserve,
              }}
            />
            <div
              style={{
                width: `${(repo.reconstructed / repo.assessed) * 100}%`,
                background: DECISION_TOKEN.reconstruct,
              }}
            />
          </div>
        ) : (
          <p className="mt-2 text-xs" style={{ color: DECISION_TOKEN.degenerate }}>
            No region in this repository was large enough to assess.
          </p>
        )}

        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
          <span className="tabular-nums">{repo.regions}</span> regions total —{" "}
          <span className="tabular-nums">{repo.assessed}</span> assessed,{" "}
          <span className="tabular-nums" style={{ color: DECISION_TOKEN.degenerate }}>
            {repo.degenerate}
          </span>{" "}
          below the measurable threshold and reconstructed by rule.
        </p>
      </div>
    </div>
  );
}

/** Every assessed score on a shared axis, with the boundary marked once. */
export function ScoreSpread({ repos }: { repos: readonly AdaptivityRepoView[] }) {
  const W = 720;
  const ROW = 34;
  const PAD_X = 16;
  const H = repos.length * ROW + 30;
  const boundary = repos[0]?.config.boundary ?? 0.5;
  const maxScore = repos.reduce(
    (m, r) => Math.max(m, r.assessedScores[r.assessedScores.length - 1] ?? 0),
    0,
  );
  const xMax = Math.min(1, Math.max(0.4, Math.ceil((Math.max(maxScore, boundary) * 1.08) / 0.1) * 0.1));
  const xOf = (score: number) => PAD_X + (score / xMax) * (W - 2 * PAD_X);

  return (
    <figure className="m-0 overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[420px]"
        role="img"
        aria-label="Assessed region scores per repository on a shared axis, with the quality boundary marked."
      >
        <line
          x1={xOf(boundary)}
          y1={4}
          x2={xOf(boundary)}
          y2={repos.length * ROW + 6}
          stroke="var(--color-decision-boundary)"
          strokeWidth={1.5}
          strokeDasharray="6 3"
        />
        <text
          x={xOf(boundary)}
          y={H - 10}
          textAnchor="middle"
          className="fill-[var(--color-decision-boundary)] font-mono text-[10px] tabular-nums"
        >
          boundary {displayNumber(boundary)}
        </text>

        {repos.map((repo, row) => {
          const y = row * ROW + 22;
          return (
            <g key={repo.id}>
              <line x1={PAD_X} y1={y} x2={W - PAD_X} y2={y} stroke="var(--color-border-default)" />
              <text
                x={PAD_X}
                y={y - 9}
                className="fill-[var(--color-text-tertiary)] font-mono text-[10px]"
              >
                {repo.name}
              </text>
              {repo.assessedScores.map((score, i) => (
                <circle
                  key={`${repo.id}-${i}`}
                  cx={xOf(score)}
                  cy={y}
                  r={2.6}
                  fill={
                    score >= boundary ? DECISION_TOKEN.preserve : DECISION_TOKEN.reconstruct
                  }
                  fillOpacity={0.55}
                />
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
        One dot per assessed region, at its recorded score. Unassessed regions are not plotted —
        they have no measured score to place. Axis to {xMax}.
      </figcaption>
    </figure>
  );
}

export function AdaptivityComparison({
  repos,
  sameConfiguration,
  configurationNote,
  skipped = [],
}: AdaptivityComparisonProps) {
  if (repos.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        No index is present on this machine, so there is nothing to compare. Index a repository
        first.
      </p>
    );
  }

  const comparable = repos.filter((r) => r.assessed > 0);
  const maxFiles = Math.max(1, ...repos.map((r) => r.files));
  const shares = comparable.map((r) => r.preserveShare ?? 0);
  const low = shares.length > 0 ? Math.min(...shares) : 0;
  const high = shares.length > 0 ? Math.max(...shares) : 0;
  const first = repos[0]!;

  return (
    <>
      {comparable.length > 1 ? (
        <p className="max-w-[74ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Across {comparable.length} indexed repositories the assessed preserve rate spans{" "}
          <strong className="font-semibold text-[var(--color-text-primary)]">
            {displayPercent(low)} to {displayPercent(high)}
          </strong>{" "}
          — a {Math.round((high - low) * 100)}-point difference produced by the same algorithm on
          different code. That difference is the adaptive behaviour: the engine measured each region
          and answered differently because the structure differed.
        </p>
      ) : (
        <p className="max-w-[74ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Only {comparable.length} repository with assessed regions is indexed on this machine, so
          there is no comparison to draw yet. Index a second repository to see the rates diverge.
        </p>
      )}

      {sameConfiguration ? (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
          <div className="flex gap-1.5">
            <dt className="text-[var(--color-text-tertiary)]">Identical across all runs</dt>
            <dd className="font-mono tabular-nums text-[var(--color-text-primary)]">
              boundary {displayNumber(first.config.boundary)} · weights{" "}
              {displayNumber(first.config.weights.cohesion)}/
              {displayNumber(first.config.weights.coupling)} · squash k{" "}
              {displayNumber(first.config.squashK)}
              {first.config.seed !== null && <> · seed {first.config.seed}</>}
              {first.config.maxGroupSize !== null && <> · max group {first.config.maxGroupSize}</>}
            </dd>
          </div>
        </dl>
      ) : (
        <p
          role="note"
          className="rounded-md border border-[var(--color-warning)] bg-[var(--color-bg-surface)] px-3 py-2 text-xs text-[var(--color-warning)]"
        >
          {configurationNote ??
            "These runs do not share one configuration, so the comparison is not controlled."}
        </p>
      )}

      <section aria-label="Preserve rate per repository">
        {repos.map((repo) => (
          <RateRow key={repo.id} repo={repo} maxFiles={maxFiles} />
        ))}
        <div className="border-t border-[var(--color-border-default)] pt-3">
          <DecisionLegend />
        </div>
      </section>

      {comparable.length > 0 && (
        <section aria-label="Assessed score spread">
          <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">
            Where the scores actually fall
          </h2>
          <p className="mb-3 max-w-[74ch] text-xs text-[var(--color-text-secondary)]">
            The rates above come from these distributions. A repository whose regions cluster above
            the boundary keeps its structure; one whose regions cluster below it gets rebuilt.
          </p>
          <ScoreSpread repos={comparable} />
        </section>
      )}

      {skipped.length > 0 && (
        <p className="text-[11px] text-[var(--color-text-tertiary)]">
          Registered but not indexed on this machine, so excluded:{" "}
          <span className="font-mono">{skipped.join(", ")}</span>.
        </p>
      )}
    </>
  );
}
