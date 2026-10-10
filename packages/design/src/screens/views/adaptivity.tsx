"use client";

import type { RepositoryRef, SnapshotState, ViewBodies } from "../../contracts";
import { EmptyState, Page, Text } from "../../components/feedback";
import { KeyValueList, Panel } from "../../components/panel";
import { DecisionTag } from "../../components/status";
import { formatBoundary, formatCount, formatShare } from "./format";
import { scoreBins, type ScoreBin } from "./regions";
import { Await, SnapshotGate } from "./snapshot-gate";
import { figuresFor } from "./overview";
import { useSnapshotViews } from "./use-views";

export type AdaptivityViews = Pick<ViewBodies, "adaptivity" | "regionDecisions">;

const HIST = { height: 220, left: 32, bottom: 24, top: 8, right: 8 } as const;
const HIST_WIDTH = 520;

/** Assessed regions by recorded score, in bins of 0.05, kept and rebuilt stacked. The bars are tallies of recorded values. */
function ScoreHistogram({ bins, boundary }: { readonly bins: readonly ScoreBin[]; readonly boundary: number }) {
  const { height, left, bottom, top, right } = HIST;
  const width = HIST_WIDTH;
  const barWidth = (width - left - right) / bins.length;
  const tallest = Math.max(1, ...bins.map((bin) => bin.kept + bin.rebuilt));
  const max = Math.ceil(tallest / 4) * 4;
  const Y = (value: number) => top + (1 - value / max) * (height - top - bottom);
  const ticks = [0, 1, 2, 3, 4].map((step) => (max / 4) * step);
  const boundaryX = left + boundary * bins.length * barWidth;
  return (
    <svg className="rh-dec-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Histogram of region scores">
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="rh-dec-grid" x1={left} x2={width - right} y1={Y(tick)} y2={Y(tick)} />
          <text className="rh-dec-mono" x={left - 6} y={Y(tick) + 4} textAnchor="end">
            {tick}
          </text>
        </g>
      ))}
      {bins.map((bin, index) => {
        const x = left + index * barWidth + 1;
        const keptTop = Y(bin.kept);
        const rebuiltTop = Y(bin.kept + bin.rebuilt);
        return (
          <g key={bin.from}>
            {bin.kept > 0 ? <rect className="rh-dec-kept" x={x} y={keptTop} width={barWidth - 2} height={Y(0) - keptTop} /> : null}
            {bin.rebuilt > 0 ? <rect className="rh-ad-rebuilt-bar" x={x} y={rebuiltTop} width={barWidth - 2} height={keptTop - rebuiltTop} /> : null}
          </g>
        );
      })}
      <line className="rh-dec-axis" x1={left} x2={width - right} y1={Y(0)} y2={Y(0)} />
      <line className="rh-dec-boundary" x1={boundaryX} x2={boundaryX} y1={top} y2={Y(0)} />
      <text x={boundaryX + 6} y={top + 12}>
        boundary {formatBoundary(boundary)}
      </text>
      {[0, 0.25, 0.5, 0.75, 1].map((value) => (
        <text key={value} className="rh-dec-mono" x={left + value * bins.length * barWidth} y={height - 6} textAnchor="middle">
          {value}
        </text>
      ))}
    </svg>
  );
}

export interface AdaptivityViewProps extends RepositoryRef {
  readonly snapshotId: string;
  readonly views: AdaptivityViews;
}

/** The Adaptivity page from loaded data: how often the engine kept a package, and the settings that produced the answer. */
export function AdaptivityView({ owner, name, views }: AdaptivityViewProps) {
  const { adaptivity, regionDecisions } = views;
  const figures = figuresFor(adaptivity, owner, name);
  if (figures === undefined) {
    return (
      <Page>
        <p className="rh-fg3" role="status">
          This snapshot recorded no figures for {owner}/{name}.
        </p>
      </Page>
    );
  }
  const bins = scoreBins(regionDecisions.regions);
  const { config } = figures;
  const others = adaptivity.repos.filter((repo) => repo.id !== figures.id);
  const assessedShare = figures.regions === 0 ? 0 : (figures.assessed / figures.regions) * 100;
  const unassessedShare = figures.regions === 0 ? 0 : (figures.degenerate / figures.regions) * 100;

  return (
    <Page>
      <header className="rh-v-head">
        <div>
          <Text role="display" figure>
            {formatShare(figures.preserveShare)}
          </Text>
          <p className="rh-fg2">
            of assessed regions kept their authored package ({formatCount(figures.preserved)} of {formatCount(figures.assessed)}).
          </p>
        </div>
      </header>

      <div className="rh-v-grid-2">
        <Panel
          title="Score distribution"
          actions={
            <Text role="caption" tone="subtle">
              Assessed regions, bins of 0.05
            </Text>
          }
        >
          <div className="rh-dec-viz">
            <ScoreHistogram bins={bins} boundary={regionDecisions.boundary} />
          </div>
          <div className="rh-v-legend rh-t-caption">
            <DecisionTag decision="kept">kept</DecisionTag>
            <DecisionTag decision="rebuilt">rebuilt</DecisionTag>
          </div>
        </Panel>

        <div className="rh-ad-stack">
          <Panel title="Coverage">
            <div className="rh-ad-cover" role="img" aria-label={`${figures.assessed} regions assessed, ${figures.degenerate} too small to measure`}>
              <i className="rh-ad-cover-assessed" style={{ width: `${assessedShare}%` }} />
              <i className="rh-ad-cover-small" style={{ width: `${unassessedShare}%` }} />
            </div>
            <div className="rh-v-legend rh-t-caption">
              <DecisionTag decision="kept">{formatCount(figures.assessed)} assessed</DecisionTag>
              <DecisionTag decision="unassessed">{formatCount(figures.degenerate)} too small to measure</DecisionTag>
            </div>
            <p className="rh-fg2">
              A region with fewer than two files, or no dependencies inside it, scores 0 by rule and is rebuilt without assessment. Percentages on this page count
              assessed regions only.
            </p>
          </Panel>

          <Panel
            title="Configuration"
            actions={
              <Text role="caption" tone="subtle">
                Recorded with the snapshot
              </Text>
            }
          >
            <KeyValueList
              items={[
                { label: "Boundary", value: <span className="rh-mono">{formatBoundary(config.boundary)}</span> },
                {
                  label: "Weights",
                  value: (
                    <span className="rh-mono">
                      cohesion {config.weights.cohesion}, coupling {config.weights.coupling}
                      {config.weights.modularity === undefined ? "" : `, modularity ${config.weights.modularity}`}
                    </span>
                  ),
                },
                { label: "Squash constant", value: <span className="rh-mono">{config.squashK}</span> },
                ...(config.seed === null ? [] : [{ label: "Seed", value: <span className="rh-mono">{config.seed}</span> }]),
                ...(config.maxGroupSize === null ? [] : [{ label: "Largest group", value: <span className="rh-mono">{formatCount(config.maxGroupSize)} files</span> }]),
                ...(config.minPartitionThreshold === null ? [] : [{ label: "Smallest split", value: <span className="rh-mono">{formatCount(config.minPartitionThreshold)} files</span> }]),
              ]}
            />
          </Panel>
        </div>
      </div>

      <Panel title="Across repositories" padded={others.length > 0}>
        {others.length === 0 ? (
          <EmptyState title="Comparison appears when two or more repositories are indexed.">
            Each repository will show its kept share on the same axis as this one.
          </EmptyState>
        ) : (
          <ul className="rh-ad-compare">
            {[figures, ...others].map((repo) => (
              <li key={repo.id}>
                <span className="rh-v-name">{repo.id}</span>
                <span className="rh-ad-axis" role="img" aria-label={`${repo.id}: ${formatShare(repo.preserveShare)} kept, of assessed`}>
                  <i style={{ width: `${(repo.preserveShare ?? 0) * 100}%` }} />
                </span>
                <span className="rh-mono">{formatShare(repo.preserveShare)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Page>
  );
}

export interface AdaptivityScreenProps extends RepositoryRef {
  readonly snapshot: SnapshotState;
}

/** The Adaptivity page: waits for the snapshot, loads the two views it draws from, then draws. */
export function AdaptivityScreen({ owner, name, snapshot }: AdaptivityScreenProps) {
  return (
    <SnapshotGate owner={owner} name={name} snapshot={snapshot} what="adaptivity">
      {(snapshotId) => <AdaptivityData owner={owner} name={name} snapshotId={snapshotId} />}
    </SnapshotGate>
  );
}

function AdaptivityData({ owner, name, snapshotId }: RepositoryRef & { readonly snapshotId: string }) {
  const views = useSnapshotViews(snapshotId, ["adaptivity", "regionDecisions"] as const);
  return (
    <Await loaded={views} what="adaptivity">
      {(bodies) => <AdaptivityView owner={owner} name={name} snapshotId={snapshotId} views={bodies} />}
    </Await>
  );
}
