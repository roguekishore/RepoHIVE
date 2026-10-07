"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RepositoryRef, SnapshotState, ViewBodies } from "../../contracts";
import { LinkButton } from "../../components/button";
import { Chip } from "../../components/controls";
import { Field } from "../../components/field";
import { Page, Text } from "../../components/feedback";
import { KeyValueList, Panel } from "../../components/panel";
import { DecisionTag } from "../../components/status";
import { Table, type SortState, type TableColumn } from "../../components/table";
import { routes } from "../../routes";
import { formatBoundary, formatCount, formatScore } from "./format";
import { assessedRegions, decisionOf, isCloseCall, tallyAssessed, type Region } from "./regions";
import { Measured } from "./measured";
import { commonNamePrefix, shortName } from "./names";
import { Await, SnapshotGate } from "./snapshot-gate";
import { useSnapshotViews } from "./use-views";

export type DecisionsViews = Pick<ViewBodies, "regionDecisions">;
type RegionFilter = "all" | "kept" | "rebuilt" | "close";
type SortKey = "name" | "files" | "cohesion" | "coupling" | "score" | "decision";

const FILTERS: readonly { readonly value: RegionFilter; readonly label: string }[] = [
  { value: "all", label: "All" },
  { value: "kept", label: "Kept" },
  { value: "rebuilt", label: "Rebuilt" },
  { value: "close", label: "Close calls" },
];

const STRIP = { height: 156, pad: 16, base: 120, step: 6, mark: 2.5 } as const;
const PLOT = { pad: 40 } as const;

/** One mark on the strip: kept is a circle, rebuilt a square, so the two differ by shape and not by colour alone. */
function Mark({ region, x, y, selected, onSelect }: { readonly region: Region; readonly x: number; readonly y: number; readonly selected: boolean; readonly onSelect: (regionId: string) => void }) {
  const kept = region.action === "preserve";
  const r = STRIP.mark;
  return (
    <g className="rh-dec-point" onClick={() => onSelect(region.regionId)}>
      {kept ? (
        <circle className="rh-dec-kept" cx={x} cy={y} r={r} />
      ) : (
        <rect className="rh-dec-rebuilt" x={x - r} y={y - r} width={r * 2} height={r * 2} />
      )}
      {selected ? <circle className="rh-dec-sel" cx={x} cy={y} r={r + 3} /> : null}
    </g>
  );
}

/** Regions on the score axis with the recorded boundary. Positions come from the recorded score and a fixed stacking rule. */
function ScoreStrip({ regions, boundary, selectedId, onSelect, measured }: { readonly regions: readonly Region[]; readonly boundary: number; readonly selectedId?: string; readonly onSelect: (regionId: string) => void; readonly measured: number }) {
  const { height, pad, base, step } = STRIP;
  const width = Math.max(280, measured);
  const x = (score: number) => pad + score * (width - 2 * pad);
  const columns = new Map<number, number>();
  const dots = [...regions]
    .sort((a, b) => a.score - b.score || (a.regionId < b.regionId ? -1 : 1))
    .map((region) => {
      const cx = Math.round(x(region.score) / step) * step;
      const level = (columns.get(cx) ?? 0) + 1;
      columns.set(cx, level);
      return { region, cx, cy: base - step - (level - 1) * step };
    });
  const bx = x(boundary);
  return (
    <svg className="rh-dec-svg" viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label={`Regions on the score axis, with the recorded boundary at ${formatBoundary(boundary)}`}>
      {Array.from({ length: 11 }, (_, tick) => (
        <g key={tick}>
          <line className="rh-dec-grid" x1={x(tick / 10)} x2={x(tick / 10)} y1={8} y2={base} />
          <text className="rh-dec-mono" x={x(tick / 10)} y={base + 20} textAnchor="middle">
            {(tick / 10).toFixed(1)}
          </text>
        </g>
      ))}
      <line className="rh-dec-axis" x1={pad} x2={width - pad} y1={base} y2={base} />
      {dots.map((dot) => (
        <Mark key={dot.region.regionId} region={dot.region} x={dot.cx} y={dot.cy} selected={dot.region.regionId === selectedId} onSelect={onSelect} />
      ))}
      <line className="rh-dec-boundary" x1={bx} x2={bx} y1={4} y2={base} />
      <rect className="rh-dec-handle" x={bx - 18} y={base - 2} width={36} height={18} rx={3} />
      <text className="rh-dec-handle-label" x={bx} y={base + 11} textAnchor="middle">
        {boundary.toFixed(2)}
      </text>
      <text x={pad} y={height - 2}>
        Rebuilt below the line
      </text>
      <text x={width - pad} y={height - 2} textAnchor="end">
        Kept at or above
      </text>
    </svg>
  );
}

/** Each region as a point by its recorded cohesion (squashed with the recorded constant) and independence (1 − coupling). */
function DecisionSpace({ regions, decisions, selectedId, onSelect, measured }: { readonly regions: readonly Region[]; readonly decisions: ViewBodies["regionDecisions"]; readonly selectedId?: string; readonly onSelect: (regionId: string) => void; readonly measured: number }) {
  const { pad } = PLOT;
  const width = Math.max(240, Math.min(measured, 520));
  const size = width - pad - 12;
  const height = size + pad + 8;
  const X = (v: number) => pad + v * size;
  const Y = (v: number) => 8 + (1 - v) * size;
  const k = decisions.cohesionSquashConstant;
  const squash = (cohesion: number) => cohesion / (cohesion + k);
  // The recorded boundary is a line in this plane only when the two axes are the whole score (no modularity weight).
  const { cohesion: wc, coupling: wp, modularity: wm } = decisions.metricWeights;
  const line = (() => {
    if ((wm ?? 0) > 0 || wc + wp <= 0) return undefined;
    if (wc <= 0 || wp <= 0) return undefined;
    // wc·sq + wp·ind = (wc + wp)·boundary, drawn between the two points where it meets the unit square.
    const points: [number, number][] = [];
    const target = (wc + wp) * decisions.boundary;
    for (const sq of [0, 1]) {
      const ind = (target - wc * sq) / wp;
      if (ind >= 0 && ind <= 1) points.push([sq, ind]);
    }
    for (const ind of [0, 1]) {
      const sq = (target - wp * ind) / wc;
      if (sq >= 0 && sq <= 1 && !points.some(([a, b]) => a === sq && b === ind)) points.push([sq, ind]);
    }
    return points.length >= 2 ? { from: points[0] as [number, number], to: points[1] as [number, number] } : undefined;
  })();
  return (
    <svg className="rh-dec-svg" viewBox={`0 0 ${width} ${height + 16}`} width={width} height={height + 16} role="img" aria-label="Regions by cohesion and independence">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line className="rh-dec-grid" x1={X(t)} x2={X(t)} y1={Y(0)} y2={Y(1)} />
          <line className="rh-dec-grid" x1={X(0)} x2={X(1)} y1={Y(t)} y2={Y(t)} />
          <text className="rh-dec-mono" x={X(t)} y={Y(0) + 16} textAnchor="middle">
            {t}
          </text>
          <text className="rh-dec-mono" x={X(0) - 8} y={Y(t) + 4} textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      {line === undefined ? null : <line className="rh-dec-boundary" x1={X(line.from[0])} y1={Y(line.from[1])} x2={X(line.to[0])} y2={Y(line.to[1])} />}
      {regions.map((region) => {
        const cx = X(squash(region.cohesion));
        const cy = Y(1 - region.coupling);
        const kept = region.action === "preserve";
        return (
          <g key={region.regionId} className="rh-dec-point" onClick={() => onSelect(region.regionId)}>
            {kept ? <circle className="rh-dec-kept" cx={cx} cy={cy} r={3} /> : <rect className="rh-dec-rebuilt" x={cx - 3} y={cy - 3} width={6} height={6} />}
          </g>
        );
      })}
      {selectedId === undefined
        ? null
        : regions
            .filter((region) => region.regionId === selectedId)
            .map((region) => <circle key="sel" className="rh-dec-sel" cx={X(squash(region.cohesion))} cy={Y(1 - region.coupling)} r={7} />)}
      <text x={X(0.5)} y={height + 14} textAnchor="middle">
        Cohesion, squashed
      </text>
      <text transform={`translate(12 ${Y(0.5)}) rotate(-90)`} textAnchor="middle">
        Independence, 1 − coupling
      </text>
    </svg>
  );
}

function compareRegions(key: SortKey, a: Region, b: Region): number {
  switch (key) {
    case "name":
      return a.displayName.localeCompare(b.displayName);
    case "files":
      return a.fileCount - b.fileCount;
    case "cohesion":
      return a.cohesion - b.cohesion;
    case "coupling":
      return a.coupling - b.coupling;
    case "score":
      return a.score - b.score;
    case "decision":
      return decisionOf(a).localeCompare(decisionOf(b));
  }
}

export interface DecisionsViewProps extends RepositoryRef {
  readonly snapshotId: string;
  readonly views: DecisionsViews;
  /** A region the page opens on (the Overview links to it with `?region=`); an unknown id selects the default. */
  readonly initialRegionId?: string;
}

/** The Decisions page from loaded data. Everything shown is a value the engine recorded; nothing is recomputed. */
export function DecisionsView({ views, initialRegionId }: DecisionsViewProps) {
  const decisions = views.regionDecisions;
  const assessed = useMemo(() => assessedRegions(decisions.regions), [decisions.regions]);
  const tally = useMemo(() => tallyAssessed(decisions.regions), [decisions.regions]);
  const notAssessed = decisions.regions.length - assessed.length;

  const defaultId = useMemo(() => {
    if (initialRegionId !== undefined && assessed.some((region) => region.regionId === initialRegionId)) return initialRegionId;
    return [...assessed].sort((a, b) => b.fileCount - a.fileCount || (a.regionId < b.regionId ? -1 : 1))[0]?.regionId;
  }, [assessed, initialRegionId]);
  const [selectedId, setSelectedId] = useState<string | undefined>(defaultId);
  const [filter, setFilter] = useState<RegionFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "files", direction: "descending" });

  // A selection made by the user scrolls its table row into view; the page's first selection does not.
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollToRow = useRef(false);
  const select = (regionId: string): void => {
    scrollToRow.current = true;
    setSelectedId(regionId);
  };
  useEffect(() => {
    if (!scrollToRow.current) return;
    scrollToRow.current = false;
    wrapRef.current?.querySelector("tr.rh-on")?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  const selected = assessed.find((region) => region.regionId === selectedId);
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const shown = assessed.filter((region) => {
      if (term !== "" && !region.displayName.toLowerCase().includes(term)) return false;
      if (filter === "kept") return region.action === "preserve";
      if (filter === "rebuilt") return region.action !== "preserve";
      if (filter === "close") return isCloseCall(region, decisions.boundary);
      return true;
    });
    const dir = sort.direction === "ascending" ? 1 : -1;
    return shown.sort((a, b) => dir * compareRegions(sort.key as SortKey, a, b) || a.displayName.localeCompare(b.displayName));
  }, [assessed, decisions.boundary, filter, query, sort]);

  const onSort = (key: string) => setSort((current) => ({ key, direction: current.key === key && current.direction === "descending" ? "ascending" : key === "name" ? "ascending" : "descending" }));

  const prefix = useMemo(() => commonNamePrefix(decisions.regions.map((region) => region.displayName)), [decisions.regions]);
  const columns: TableColumn<Region>[] = [
    {
      key: "name",
      header: "Region",
      sortable: true,
      render: (region) => (
        <span className="rh-v-name" title={region.displayName}>
          {shortName(region.displayName, prefix)}
        </span>
      ),
    },
    { key: "files", header: "Files", numeric: true, sortable: true, render: (region) => formatCount(region.fileCount) },
    { key: "cohesion", header: "Cohesion", numeric: true, sortable: true, render: (region) => formatScore(region.cohesion) },
    { key: "coupling", header: "Coupling", numeric: true, sortable: true, render: (region) => formatScore(region.coupling) },
    { key: "score", header: "Score", numeric: true, sortable: true, render: (region) => formatScore(region.score) },
    { key: "decision", header: "Decision", sortable: true, render: (region) => <DecisionTag decision={decisionOf(region)} /> },
  ];

  const weights = decisions.metricWeights;
  return (
    <Page>
      <Panel
        title="Boundary"
        actions={
          <div className="rh-dec-readout rh-t-caption rh-fg2">
            <span>
              Boundary <span className="rh-mono">{formatBoundary(decisions.boundary)}</span>
            </span>
            <span>{formatCount(tally.kept)} kept</span>
            <span>{formatCount(tally.rebuilt)} rebuilt</span>
            <span className="rh-fg3">As recorded</span>
          </div>
        }
      >
        <Measured>
          {(width) => <ScoreStrip regions={assessed} boundary={decisions.boundary} selectedId={selectedId} onSelect={select} measured={width} />}
        </Measured>
        <Text role="caption" tone="subtle">
          {formatCount(assessed.length)} assessed regions on the score axis, at the boundary the run recorded. {formatCount(notAssessed)} regions too small to measure are not shown.
        </Text>
      </Panel>

      <div className="rh-v-grid-2">
        <Panel
          title="Decision space"
          actions={
            <Text role="caption" tone="subtle">
              Score blends the two axes
            </Text>
          }
        >
          <Measured>
            {(width) => <DecisionSpace regions={assessed} decisions={decisions} selectedId={selectedId} onSelect={select} measured={width} />}
          </Measured>
        </Panel>

        <Panel
          title="Working"
          actions={
            selected === undefined ? undefined : (
              <Text role="caption" tone="subtle">
                {formatCount(selected.fileCount)} files · {formatCount(selected.groupIds.length)} {selected.groupIds.length === 1 ? "group" : "groups"}
              </Text>
            )
          }
        >
          {selected === undefined ? (
            <Text role="caption" tone="subtle">
              Pick a region to see the values the engine recorded for it.
            </Text>
          ) : (
            <div className="rh-dec-work">
              <div className="rh-dec-work-head">
                <Text as="h2" role="lead" className="rh-dec-work-name" title={selected.displayName}>
                  {shortName(selected.displayName, prefix)}
                </Text>
                <DecisionTag decision={decisionOf(selected)} />
              </div>
              <KeyValueList
                items={[
                  { label: "Cohesion", value: <span className="rh-mono">{formatScore(selected.cohesion)}</span> },
                  { label: "Coupling", value: <span className="rh-mono">{formatScore(selected.coupling)}</span> },
                  ...(selected.modularity === undefined ? [] : [{ label: "Modularity", value: <span className="rh-mono">{formatScore(selected.modularity)}</span> }]),
                  { label: "Score", value: <span className="rh-mono">{formatScore(selected.score)}</span> },
                  { label: "Boundary", value: <span className="rh-mono">{formatBoundary(decisions.boundary)}</span> },
                  { label: "Action", value: selected.action === "preserve" ? "Keep the package" : "Rebuild from dependencies" },
                  { label: "Measured action", value: selected.automaticAction === "preserve" ? "Keep the package" : "Rebuild from dependencies" },
                  { label: "Overridden", value: selected.userOverridden ? "Yes" : "No" },
                  { label: "Confidence", value: <span className="rh-mono">{formatScore(selected.decisionConfidence)}</span> },
                ]}
              />
              <Text role="caption" tone="subtle">
                Weights: cohesion {weights.cohesion}, coupling {weights.coupling}
                {weights.modularity === undefined ? "" : `, modularity ${weights.modularity}`}. Squash constant {decisions.cohesionSquashConstant}
                {decisions.seed === null ? "" : `, seed ${decisions.seed}`}.
              </Text>
            </div>
          )}
        </Panel>
      </div>

      <section className="rh-v-section">
        <div className="rh-v-section-head">
          <Text as="h2" role="title">
            All regions
          </Text>
          <div className="rh-dec-tools">
            <div className="rh-dec-chips" role="group" aria-label="Show">
              {FILTERS.map((option) => (
                <Chip key={option.value} pressed={filter === option.value} onClick={() => setFilter(option.value)}>
                  {option.label}
                </Chip>
              ))}
            </div>
            <Field className="rh-dec-filter" icon="search" placeholder="Filter regions" aria-label="Filter regions" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
          </div>
        </div>
        <div className="rh-panel rh-v-scroll" ref={wrapRef}>
          <Table
            caption="All regions"
            columns={columns}
            rows={rows}
            rowKey={(region) => region.regionId}
            sort={sort}
            onSort={onSort}
            selectedKey={selectedId}
            onRowActivate={(region) => select(region.regionId)}
            emptyRow="No regions match. Clear the search or pick another filter."
          />
        </div>
      </section>
    </Page>
  );
}

/** The top-bar action of the Decisions page. */
export function DecisionsActions() {
  return (
    <LinkButton size="sm" variant="ghost" href={routes.method}>
      How scores work
    </LinkButton>
  );
}

export interface DecisionsScreenProps extends RepositoryRef {
  readonly snapshot: SnapshotState;
  readonly initialRegionId?: string;
}

/** The Decisions page: waits for the snapshot, loads the recorded decisions, then draws. */
export function DecisionsScreen({ owner, name, snapshot, initialRegionId }: DecisionsScreenProps) {
  return (
    <SnapshotGate owner={owner} name={name} snapshot={snapshot} what="the decisions">
      {(snapshotId) => <DecisionsData owner={owner} name={name} snapshotId={snapshotId} initialRegionId={initialRegionId} />}
    </SnapshotGate>
  );
}

function DecisionsData({ owner, name, snapshotId, initialRegionId }: RepositoryRef & { readonly snapshotId: string; readonly initialRegionId?: string }) {
  const views = useSnapshotViews(snapshotId, ["regionDecisions"] as const);
  return (
    <Await loaded={views} what="the decisions">
      {(bodies) => <DecisionsView owner={owner} name={name} snapshotId={snapshotId} views={bodies} initialRegionId={initialRegionId} />}
    </Await>
  );
}
