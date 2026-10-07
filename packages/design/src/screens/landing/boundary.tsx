"use client";

import { useMemo, useRef, useState, type PointerEvent } from "react";
import { Button } from "../../components/button";
import { Text } from "../../components/feedback";
import { Measured } from "../views/measured";
import type { LandingFigures, RegionRow } from "./figures-types";

const number = new Intl.NumberFormat("en-US");
const MIN = 0.05;
const MAX = 0.95;
const HEIGHT = 172;
const PAD = 18;
const BASE = 132;
const CLOSE_COUNT = 6;

const decisionOf = (row: RegionRow, boundary: number): 1 | 2 => (row[4] >= boundary ? 1 : 2);
const clampBoundary = (value: number): number => Math.round(Math.min(MAX, Math.max(MIN, value)) * 100) / 100;

function DecisionMark({ kept }: { readonly kept: boolean }) {
  return (
    <span className={kept ? "rh-ld-dtag rh-ld-k" : "rh-ld-dtag rh-ld-r"}>
      <i />
      {kept ? "Kept" : "Rebuilt"}
    </span>
  );
}

interface StripProps {
  readonly rows: readonly RegionRow[];
  readonly boundary: number;
  readonly width: number;
  readonly pickedName: string | undefined;
  readonly onPick: (name: string) => void;
  readonly onBoundary: (value: number) => void;
}

/** The measured regions on the score axis, drawn at the width it is given. A drag on the strip moves the line. */
function Strip({ rows, boundary, width: measured, pickedName, onPick, onBoundary }: StripProps) {
  const width = Math.max(280, measured);
  const step = width < 600 ? 5 : 6;
  const narrow = width < 520;
  const dragging = useRef(false);
  const x = (score: number): number => PAD + score * (width - 2 * PAD);
  const dots = useMemo(() => {
    const columns = new Map<number, number>();
    return [...rows]
      .sort((a, b) => a[4] - b[4] || (a[0] < b[0] ? -1 : 1))
      .map((row) => {
        const cx = Math.round((PAD + row[4] * (width - 2 * PAD)) / step) * step;
        const level = (columns.get(cx) ?? 0) + 1;
        columns.set(cx, level);
        return { row, cx, cy: BASE - 6 - (level - 1) * step };
      });
  }, [rows, width, step]);
  const bx = x(boundary);

  const fromEvent = (event: PointerEvent<SVGSVGElement>): number => {
    const box = event.currentTarget.getBoundingClientRect();
    return (event.clientX - box.left - (PAD * box.width) / width) / (box.width - (2 * PAD * box.width) / width);
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      width={width}
      height={HEIGHT}
      role="img"
      aria-label={`Measured regions on the score axis with the boundary at ${boundary.toFixed(2)}`}
      onPointerDown={(event) => {
        const target = (event.target as Element).closest("circle[data-pick]");
        if (target !== null) {
          onPick(target.getAttribute("data-pick") ?? "");
          return;
        }
        dragging.current = true;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // A synthetic pointer cannot be captured; the drag still works while it stays over the strip.
        }
        onBoundary(fromEvent(event));
      }}
      onPointerMove={(event) => {
        if (dragging.current) onBoundary(fromEvent(event));
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
    >
      {Array.from({ length: 11 }, (_, tick) => (
        <g key={tick}>
          <line className="rh-ld-grid" x1={x(tick / 10)} x2={x(tick / 10)} y1={8} y2={BASE} />
          {narrow && tick % 2 === 1 ? null : (
            <text x={x(tick / 10)} y={BASE + 20} textAnchor="middle">
              {(tick / 10).toFixed(1)}
            </text>
          )}
        </g>
      ))}
      <line className="rh-ld-axis" x1={PAD} x2={width - PAD} y1={BASE} y2={BASE} />
      {dots.map(({ row, cx, cy }) => {
        const now = decisionOf(row, boundary);
        const changed = now !== row[5];
        return <circle key={row[0]} className={`${now === 1 ? "rh-ld-kept" : "rh-ld-rebuilt"}${changed ? " rh-ld-flip" : ""}`} cx={cx} cy={cy} r={changed ? 3.2 : 2.6} data-pick={row[0]} />;
      })}
      {dots
        .filter(({ row }) => row[0] === pickedName)
        .map(({ row, cx, cy }) => (
          <circle key={row[0]} className="rh-ld-sel" cx={cx} cy={cy} r={6} />
        ))}
      <line className="rh-ld-bnd" x1={bx} x2={bx} y1={4} y2={BASE} />
      <rect className="rh-ld-handle" x={bx - 20} y={BASE - 3} width={40} height={20} rx={3} />
      <text className="rh-ld-hlabel" x={bx} y={BASE + 11} textAnchor="middle">
        {boundary.toFixed(2)}
      </text>
      {narrow ? null : (
        <>
          <text x={PAD} y={HEIGHT - 2}>
            Rebuilt below the line
          </text>
          <text x={width - PAD} y={HEIGHT - 2} textAnchor="end">
            Kept at or above
          </text>
        </>
      )}
    </svg>
  );
}

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
  const set = (value: number): void => setBoundary(clampBoundary(value));

  const keptNow = rows.filter((row) => decisionOf(row, boundary) === 1).length;
  const flips = rows.filter((row) => decisionOf(row, boundary) !== row[5]).length;
  const picked = rows.find((row) => row[0] === pickedName);
  const closest = useMemo(
    () => [...rows].sort((a, b) => Math.abs(a[4] - recorded) - Math.abs(b[4] - recorded) || b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, CLOSE_COUNT),
    [rows, recorded],
  );

  return (
    <>
      <section className="rh-panel">
        <header className="rh-panel-head">
          <div className="rh-ld-readout" aria-live="polite">
            <span className="rh-ld-big">{boundary.toFixed(2)}</span>
            <span>boundary</span>
            <span>
              <b>{number.format(keptNow)}</b> kept · <b>{number.format(rows.length - keptNow)}</b> rebuilt
            </span>
            {flips > 0 ? <span className="rh-ld-chg">{number.format(flips)} would change</span> : <span className="rh-fg3">As recorded</span>}
          </div>
          {flips > 0 ? <Button onClick={() => setBoundary(recorded)}>Reset to {recorded.toFixed(2)}</Button> : null}
        </header>
        <div className="rh-panel-body">
          <Measured className="rh-ld-strip">
            {(width) => <Strip rows={rows} boundary={boundary} width={width} pickedName={pickedName} onPick={setPickedName} onBoundary={set} />}
          </Measured>
          <input className="rh-ld-range" type="range" min={MIN} max={MAX} step={0.01} value={boundary} aria-label="Boundary" onChange={(event) => set(Number(event.target.value))} />
          <Text role="caption" tone="subtle">
            A what-if on the recorded scores of the {number.format(rows.length)} measured regions. Nothing is re-indexed; the decisions the engine made are the ones at {recorded.toFixed(2)}.
          </Text>
        </div>
      </section>

      <div className="rh-ld-bd-grid">
        <section className="rh-panel">
          <header className="rh-panel-head">
            <h3>Working</h3>
            {picked === undefined ? null : (
              <span className="rh-fg3">
                {number.format(picked[1])} files · {number.format(picked[6])} {picked[6] === 1 ? "group" : "groups"}
              </span>
            )}
          </header>
          <div className="rh-panel-body">
            {picked === undefined ? (
              <Text role="caption" tone="subtle">
                Pick a region on the strip or in the list.
              </Text>
            ) : (
              <>
                <div className="rh-ld-work-head">
                  <h4>{picked[0]}</h4>
                  <DecisionMark kept={decisionOf(picked, boundary) === 1} />
                </div>
                <div className="rh-ld-calc">
                  <div>cohesion {picked[2].toFixed(3)}</div>
                  <div>coupling {picked[3].toFixed(3)}</div>
                  <div className="rh-ld-res">score {picked[4].toFixed(3)}</div>
                  <div>
                    boundary {boundary.toFixed(2)} → {decisionOf(picked, boundary) === 1 ? "kept" : "rebuilt"}
                  </div>
                </div>
                {decisionOf(picked, boundary) !== picked[5] ? (
                  <Text role="caption" tone="accent">
                    At this boundary the decision would change from {picked[5] === 1 ? "kept" : "rebuilt"} to {decisionOf(picked, boundary) === 1 ? "kept" : "rebuilt"}.
                  </Text>
                ) : (
                  <Text role="caption" tone="subtle">
                    Cohesion, coupling and score are the values the engine recorded, at the recorded boundary of {recorded.toFixed(2)}.
                  </Text>
                )}
              </>
            )}
          </div>
        </section>
        <section className="rh-panel">
          <header className="rh-panel-head">
            <h3>Closest calls</h3>
            <span className="rh-fg3">Smallest margin from {String(recorded)}</span>
          </header>
          <ul className="rh-ld-close-list">
            {closest.map((row) => (
              <li key={row[0]}>
                <button type="button" className={row[0] === pickedName ? "rh-ld-on" : undefined} onClick={() => setPickedName(row[0])}>
                  <span className="rh-ld-nm">{row[0]}</span>
                  <span className="rh-ld-sc">{row[4].toFixed(3)}</span>
                  <DecisionMark kept={row[5] === 1} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
