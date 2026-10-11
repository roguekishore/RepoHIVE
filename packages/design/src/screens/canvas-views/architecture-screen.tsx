"use client";

import { memo, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { EmptyState, Page } from "../../components/feedback";
import { KeyValueList, Panel } from "../../components/panel";
import { DecisionGlyph } from "../../components/status";
import { Table, type TableColumn } from "../../components/table";
import { BLOCK_PHRASE, blockLook, blockOf, cellAt, cellSize, type DsmBlock, type DsmGroup } from "./dsm";
import { levelName } from "../views/names";
import { formatCount, regionName } from "./names";
import { useElementSize } from "./use-element-size";
import type { ArchitectureBody } from "./view-types";

export interface ArchitectureScreenProps {
  /** The `architecture` view body, loaded by the host. */
  readonly data: ArchitectureBody;
}

type LevelRow = ArchitectureBody["levels"][number];
type FragmentedRegion = ArchitectureBody["fragmentation"]["regions"][number];

const USED_BY_ROWS = 8;
const HASH_SHOWN = 22;

const caption = (text: string) => <span className="rh-t-caption rh-fg3">{text}</span>;
const truncated = (id: string): string => (id.length > HASH_SHOWN ? `${id.slice(0, HASH_SHOWN)}…` : id);

interface MatrixProps {
  readonly dsm: ArchitectureBody["dsm"];
  readonly cell: number;
}

/** The cells and the region outlines. They do not depend on the pointer, so a hover does not redraw them. */
const MatrixBody = memo(function MatrixBody({ dsm, cell }: MatrixProps) {
  return (
    <>
      {dsm.entries.map((entry) => (
        <rect
          key={`${entry.from}:${entry.to}`}
          className="rh-dsm-cell"
          x={entry.to * cell}
          y={entry.from * cell}
          width={cell}
          height={cell}
          opacity={(0.15 + 0.85 * Math.sqrt(entry.weight / dsm.maxWeight)).toFixed(2)}
        />
      ))}
      {dsm.blocks.map((block) => (
        <rect
          key={block.regionId}
          className={`rh-dsm-blk ${blockLook(block.state) === "rebuilt" ? "rh-r" : blockLook(block.state) === "unassessed" ? "rh-u" : ""}`}
          x={block.start * cell}
          y={block.start * cell}
          width={block.size * cell}
          height={block.size * cell}
        />
      ))}
    </>
  );
});

/** Dependencies between groups, the levels, how far packages were split, and why a re-run matches. */
export function ArchitectureScreen({ data }: ArchitectureScreenProps) {
  const { dsm, levels, fragmentation, determinism } = data;
  const groups = dsm.groups;
  const wrapRef = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(wrapRef);
  const cell = cellSize(width, groups.length);
  const side = cell * groups.length;

  const [cursor, setCursor] = useState<{ x: number; y: number } | undefined>(undefined);
  const [locked, setLocked] = useState(-1);
  const [previewed, setPreviewed] = useState(-1);
  const [reading, setReading] = useState(
    "Rows depend on columns; darker means more dependencies. Squares on the diagonal are regions: solid kept, dashed rebuilt, dotted not assessed.",
  );

  const weights = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of dsm.entries) map.set(`${entry.from}:${entry.to}`, entry.weight);
    return map;
  }, [dsm.entries]);

  const label = (index: number): string => {
    const group = groups[index];
    const block = blockOf(dsm.blocks, index);
    return `${group?.label ?? ""}${block === undefined ? "" : ` (${block.label})`}`;
  };

  const readCell = (x: number, y: number): void => {
    const weight = weights.get(`${y}:${x}`);
    setReading(`${label(y)} → ${label(x)} · ${weight === undefined ? "no dependency" : `weight ${formatCount(weight)}`}`);
  };

  const onMove = (event: MouseEvent<SVGSVGElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const found = cellAt(event.clientX, event.clientY, box, cell, groups.length);
    if (found === undefined) return;
    setCursor(found);
    readCell(found.x, found.y);
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    const step: Record<string, readonly [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (event.key === "Escape") {
      setCursor(undefined);
      return;
    }
    const delta = step[event.key];
    if (delta === undefined || groups.length === 0) return;
    event.preventDefault();
    const from = cursor ?? { x: 0, y: 0 };
    const next = {
      x: Math.min(groups.length - 1, Math.max(0, from.x + (cursor === undefined ? 0 : delta[0]))),
      y: Math.min(groups.length - 1, Math.max(0, from.y + (cursor === undefined ? 0 : delta[1]))),
    };
    setCursor(next);
    readCell(next.x, next.y);
  };

  const lockBlock = (index: number): void => {
    const next = locked === index ? -1 : index;
    setLocked(next);
    const block = dsm.blocks[next];
    if (block !== undefined) {
      setReading(`${block.label} · ${formatCount(block.size)} groups · ${BLOCK_PHRASE[blockLook(block.state)]}`);
    }
  };

  const pickGroup = (index: number): void => {
    setCursor({ x: index, y: index });
    const block = blockOf(dsm.blocks, index);
    setLocked(block === undefined ? -1 : dsm.blocks.indexOf(block));
    const group = groups[index];
    if (group !== undefined) {
      setReading(`${group.label} · used by weight ${formatCount(group.inWeight)}, uses weight ${formatCount(group.outWeight)}`);
    }
    wrapRef.current?.scrollIntoView?.({ block: "nearest" });
  };

  const shownBlock = dsm.blocks[previewed >= 0 ? previewed : locked];

  const usedIndexes = useMemo(
    () =>
      groups
        .map((group, index) => ({ group, index }))
        .sort((a, b) => b.group.inWeight - a.group.inWeight || a.index - b.index)
        .slice(0, USED_BY_ROWS),
    [groups],
  );

  const usedColumns: readonly TableColumn<{ group: DsmGroup; index: number }>[] = [
    { key: "group", header: "Group", render: (row) => row.group.label },
    {
      key: "region",
      header: "Region",
      render: (row) => <span className="rh-fg2">{blockOf(dsm.blocks, row.index)?.label ?? "-"}</span>,
    },
    { key: "files", header: "Files", numeric: true, render: (row) => formatCount(row.group.files) },
    { key: "usedBy", header: "Used by", numeric: true, render: (row) => formatCount(row.group.inWeight) },
    { key: "uses", header: "Uses", numeric: true, render: (row) => formatCount(row.group.outWeight) },
  ];

  const maxCrossing = Math.max(0, ...levels.map((row) => row.crossGroupEdgeCount));
  const levelColumns: readonly TableColumn<LevelRow>[] = [
    {
      key: "level",
      header: "Level",
      render: (row) => (
        <>
          {row.level} <span className="rh-fg3">{levelName(row.level, levels.length)}</span>
        </>
      ),
    },
    { key: "nodes", header: "Nodes", numeric: true, render: (row) => formatCount(row.groupNodeCount + row.leafNodeCount) },
    {
      key: "cross",
      header: "Cross-group edges",
      numeric: true,
      render: (row) => (row.crossGroupEdgeCount > 0 ? formatCount(row.crossGroupEdgeCount) : "-"),
    },
    {
      key: "bar",
      width: "28%",
      header: <span className="rh-sr-only">Share of the largest</span>,
      render: (row) => (
        <div className="rh-cv-bar-cell" aria-hidden="true">
          <div className="rh-bar">
            <i style={{ width: `${maxCrossing === 0 ? 0 : (row.crossGroupEdgeCount / maxCrossing) * 100}%` }} />
          </div>
        </div>
      ),
    },
  ];

  const maxFiles = Math.max(1, ...fragmentation.regions.map((region) => region.files));
  const example = determinism.samples[0];

  return (
    <Page>
      <Panel
        title="Dependencies between groups"
        actions={caption(
          `Level ${dsm.level} · ${formatCount(groups.length)} of ${formatCount(dsm.totalGroups)} groups · ${formatCount(dsm.shownEdges)} of ${formatCount(dsm.totalEdges)} edges`,
        )}
      >
        {groups.length === 0 ? (
          <EmptyState title="No groups at this level">The index records no groups to draw a matrix of.</EmptyState>
        ) : (
          <div className="rh-dsm-layout">
            <div className="rh-dsm-col">
              <div ref={wrapRef} className="rh-dsm-wrap">
                <svg
                  viewBox={`-1 -1 ${side + 2} ${side + 2}`}
                  role="application"
                  aria-label={`Dependency matrix of ${groups.length} groups. Arrow keys move between cells.`}
                  tabIndex={0}
                  onMouseMove={onMove}
                  onMouseLeave={() => setCursor(undefined)}
                  onKeyDown={onKeyDown}
                >
                  <rect className="rh-dsm-frame" x={0} y={0} width={side} height={side} />
                  {cursor === undefined ? null : (
                    <>
                      <rect className="rh-dsm-cross" x={0} y={cursor.y * cell} width={side} height={cell} />
                      <rect className="rh-dsm-cross" x={cursor.x * cell} y={0} width={cell} height={side} />
                    </>
                  )}
                  <MatrixBody dsm={dsm} cell={cell} />
                  {shownBlock === undefined ? null : (
                    <rect
                      className="rh-dsm-blk rh-on"
                      x={shownBlock.start * cell}
                      y={shownBlock.start * cell}
                      width={shownBlock.size * cell}
                      height={shownBlock.size * cell}
                    />
                  )}
                  {cursor === undefined ? null : (
                    <rect className="rh-dsm-hl" x={cursor.x * cell} y={cursor.y * cell} width={cell} height={cell} />
                  )}
                </svg>
              </div>
              <p className="rh-t-caption rh-fg2" aria-live="polite">
                {reading}
              </p>
            </div>
            <div className="rh-dsm-col">
              <span className="rh-t-label">Regions on the diagonal</span>
              <ul className="rh-blk-list" onMouseLeave={() => setPreviewed(-1)}>
                {dsm.blocks.map((block: DsmBlock, index) => (
                  <li key={block.regionId}>
                    <button
                      type="button"
                      aria-pressed={locked === index}
                      className={locked === index ? "rh-on" : undefined}
                      onMouseEnter={() => setPreviewed(index)}
                      onClick={() => lockBlock(index)}
                    >
                      <DecisionGlyph decision={blockLook(block.state)} />
                      <span title={regionName(block.regionId)}>{block.label}</span>
                      <span className="rh-fg3 rh-mono">{block.size}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Panel>

      <div className="rh-cv-grid-2">
        <Panel title="Most depended-on groups" actions={caption("Shown groups, by incoming weight")} padded={false}>
          <Table
            caption="Most depended-on groups"
            columns={usedColumns}
            rows={usedIndexes}
            rowKey={(row) => row.group.id}
            onRowActivate={(row) => pickGroup(row.index)}
            empty={<EmptyState title="No groups to rank" />}
          />
        </Panel>
        <Panel title="Levels" actions={caption("Nodes, and edges crossing groups")} padded={false}>
          <Table caption="Levels" columns={levelColumns} rows={levels} rowKey={(row) => String(row.level)} />
        </Panel>
      </div>

      <div className="rh-cv-grid-2">
        <Panel
          title="How far packages were split"
          actions={caption(
            `${formatCount(fragmentation.totalReconstructed)} rebuilt; the largest became ${formatCount(fragmentation.maxSplit)} groups`,
          )}
        >
          {fragmentation.regions.length === 0 ? (
            <EmptyState title="No package was split">No region was rebuilt, so no authored package was divided.</EmptyState>
          ) : (
            <div>
              {fragmentation.regions.map((region: FragmentedRegion) => (
                <div className="rh-frag-row" key={region.regionId}>
                  <span className="rh-frag-nm" title={regionName(region.regionId)}>
                    {region.label}
                  </span>
                  <span className="rh-t-caption rh-fg3 rh-num">{`${formatCount(region.groupCount)} groups`}</span>
                  <div className="rh-frag-segs" style={{ width: `${(region.files / maxFiles) * 100}%` }}>
                    {region.groupSizes.map((size, index) => (
                      <i key={index} style={{ flex: size }} />
                    ))}
                  </div>
                </div>
              ))}
              {fragmentation.omittedRegions > 0 ? (
                <p className="rh-t-caption rh-fg3">{`${formatCount(fragmentation.omittedRegions)} more rebuilt regions are not listed.`}</p>
              ) : null}
            </div>
          )}
        </Panel>
        <Panel title="Why a re-run matches">
          <p className="rh-fg2">
            Each group&apos;s id is a hash of its sorted member ids, and clustering uses a fixed seed. Indexing the same commit again
            produces the same groups, the same ids and byte-identical files.
          </p>
          <KeyValueList
            className="rh-t-caption"
            items={[
              { label: "Id scheme", value: <span className="rh-cv-code">{determinism.scheme}</span> },
              ...(determinism.seed === null ? [] : [{ label: "Seed", value: <span className="rh-mono">{determinism.seed}</span> }]),
              {
                label: "Repository",
                value: (
                  <span className="rh-mono" title={determinism.repositoryId}>
                    {truncated(determinism.repositoryId)}
                  </span>
                ),
              },
              ...(example === undefined
                ? []
                : [
                    {
                      label: "Example group",
                      value: (
                        <span className="rh-mono" title={example.id}>
                          {`${truncated(example.id)} · ${formatCount(example.memberCount)} members`}
                        </span>
                      ),
                    },
                  ]),
            ]}
          />
        </Panel>
      </div>
    </Page>
  );
}
