"use client";

import { useMemo, useState } from "react";
import { Button } from "../../components/button";
import { Text } from "../../components/feedback";
import { KeyValueList, Panel } from "../../components/panel";
import { DecisionTag } from "../../components/status";
import type { LandingFigures, RegionRow } from "./figures-types";

const number = new Intl.NumberFormat("en-US");
const MIN = 0.05;
const MAX = 0.95;
const WIDTH = 600;
const HEIGHT = 156;
const PAD = 16;
const BASE = 120;
const STEP = 6;
const CLOSE_COUNT = 6;

const decisionOf = (row: RegionRow, boundary: number): 1 | 2 => (row[4] >= boundary ? 1 : 2);
const clampBoundary = (value: number): number => Math.round(Math.min(MAX, Math.max(MIN, value)) * 100) / 100;

/**
 * The boundary on the recorded scores of the measured regions. This is a what-if and is labelled as one: it moves the
 * line over the scores the index recorded and counts which side each falls on. Nothing is re-indexed, and the decisions
 * the engine actually made are the ones at the recorded boundary.
 */
export function BoundaryWhatIf({ figures }: { readonly figures: LandingFigures }) {
  const recorded = figures.settings.boundary;
  const rows = figures.regions;
  const [boundary, setBoundary] = useState(recorded);
  const [pickedName, setPickedName] = useState<string | undefined>(figures.featured.rebuilt);

  const dots = useMemo(() => {
    const columns = new Map<number, number>();
    const x = (score: number): number => PAD + score * (WIDTH - 2 * PAD);
    return [...rows]
      .sort((a, b) => a[4] - b[4] || (a[0] < b[0] ? -1 : 1))
      .map((row) => {
        const cx = Math.round(x(row[4]) / STEP) * STEP;
        const level = (columns.get(cx) ?? 0) + 1;
        columns.set(cx, level);
        return { row, cx, cy: BASE - STEP - (level - 1) * STEP };
      });
  }, [rows]);

  const keptNow = rows.filter((row) => decisionOf(row, boundary) === 1).length;
  const flips = rows.filter((row) => decisionOf(row, boundary) !== row[5]).length;
  const picked = rows.find((row) => row[0] === pickedName);
  const closest = useMemo(() => [...rows].sort((a, b) => Math.abs(a[4] - recorded) - Math.abs(b[4] - recorded) || (a[0] < b[0] ? -1 : 1)).slice(0, CLOSE_COUNT), [rows, recorded]);
  const bx = PAD + boundary * (WIDTH - 2 * PAD);

  return (
    <>
      <Panel
        title="What if the boundary moved?"
        actions={
          <div className="rh-ld-readout rh-t-caption">
            <span className="rh-fg2">
              Boundary <span className="rh-mono">{boundary.toFixed(2)}</span> · {number.format(keptNow)} kept · {number.format(rows.length - keptNow)} rebuilt
            </span>
            {flips === 0 ? (
              <span className="rh-fg3">As recorded</span>
            ) : (
              <>
                <span className="rh-ld-acc">{number.format(flips)} would change</span>
                <Button size="sm" onClick={() => setBoundary(recorded)}>
                  Reset to {recorded.toFixed(2)}
                </Button>
              </>
            )}
          </div>
        }
      >
        <svg className="rh-ld-strip" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Measured regions on the score axis, with the boundary you set">
          {Array.from({ length: 11 }, (_, tick) => (
            <g key={tick}>
              <line className="rh-dec-grid" x1={PAD + (tick / 10) * (WIDTH - 2 * PAD)} x2={PAD + (tick / 10) * (WIDTH - 2 * PAD)} y1={8} y2={BASE} />
              <text className="rh-dec-mono" x={PAD + (tick / 10) * (WIDTH - 2 * PAD)} y={BASE + 20} textAnchor="middle">
                {(tick / 10).toFixed(1)}
              </text>
            </g>
          ))}
          <line className="rh-dec-axis" x1={PAD} x2={WIDTH - PAD} y1={BASE} y2={BASE} />
          {dots.map(({ row, cx, cy }) => {
            const now = decisionOf(row, boundary);
            const changed = now !== row[5];
            return (
              <g key={row[0]} className="rh-ld-dot" onClick={() => setPickedName(row[0])}>
                {now === 1 ? <circle className={changed ? "rh-ld-flip" : "rh-dec-kept"} cx={cx} cy={cy} r={2.5} /> : <rect className={changed ? "rh-ld-flip" : "rh-dec-rebuilt"} x={cx - 2.5} y={cy - 2.5} width={5} height={5} />}
                {row[0] === pickedName ? <circle className="rh-dec-sel" cx={cx} cy={cy} r={5.5} /> : null}
              </g>
            );
          })}
          <line className="rh-dec-boundary" x1={bx} x2={bx} y1={4} y2={BASE} />
          <rect className="rh-dec-handle" x={bx - 18} y={BASE - 2} width={36} height={18} rx={3} />
          <text className="rh-dec-handle-label" x={bx} y={BASE + 11} textAnchor="middle">
            {boundary.toFixed(2)}
          </text>
          <text x={PAD} y={HEIGHT - 2}>
            Rebuilt below the line
          </text>
          <text x={WIDTH - PAD} y={HEIGHT - 2} textAnchor="end">
            Kept at or above
          </text>
        </svg>
        <input className="rh-ld-range" type="range" min={MIN} max={MAX} step={0.01} value={boundary} aria-label="Boundary" onChange={(event) => setBoundary(clampBoundary(Number(event.target.value)))} />
        <Text role="caption" tone="subtle">
          A what-if on the recorded scores of the {number.format(rows.length)} measured regions. Nothing is re-indexed; the decisions the engine made are the ones at {recorded.toFixed(2)}.
        </Text>
      </Panel>

      <div className="rh-ld-bd-grid">
        <Panel title="Working" actions={picked === undefined ? undefined : <span className="rh-fg3 rh-t-caption">{number.format(picked[1])} files · {number.format(picked[6])} groups</span>}>
          {picked === undefined ? (
            <Text role="caption" tone="subtle">
              Pick a region on the strip or in the list.
            </Text>
          ) : (
            <div className="rh-dec-work">
              <div className="rh-dec-work-head">
                <Text as="h3" role="lead" className="rh-dec-work-name">
                  {picked[0]}
                </Text>
                <DecisionTag decision={picked[5] === 1 ? "kept" : "rebuilt"} />
              </div>
              <KeyValueList
                items={[
                  { label: "Cohesion", value: <span className="rh-mono">{picked[2].toFixed(3)}</span> },
                  { label: "Coupling", value: <span className="rh-mono">{picked[3].toFixed(3)}</span> },
                  { label: "Score", value: <span className="rh-mono">{picked[4].toFixed(3)}</span> },
                  { label: "Recorded boundary", value: <span className="rh-mono">{recorded.toFixed(2)}</span> },
                  { label: `At ${boundary.toFixed(2)}`, value: decisionOf(picked, boundary) === 1 ? "Kept" : "Rebuilt" },
                ]}
              />
              <Text role="caption" tone="subtle">
                Cohesion, coupling and score are the values the engine recorded.
              </Text>
            </div>
          )}
        </Panel>
        <Panel title="Closest calls" padded={false} actions={<span className="rh-fg3 rh-t-caption">Nearest the recorded {recorded.toFixed(2)}</span>}>
          <ul className="rh-v-rows">
            {closest.map((row) => (
              <li key={row[0]}>
                <button type="button" className="rh-v-row-link rh-ld-close" onClick={() => setPickedName(row[0])}>
                  <span className="rh-v-name">{row[0]}</span>
                  <span className="rh-tag rh-t-caption">
                    <span className="rh-mono rh-fg2">{row[4].toFixed(3)}</span>
                    <DecisionTag decision={row[5] === 1 ? "kept" : "rebuilt"} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
