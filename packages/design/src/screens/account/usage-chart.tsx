"use client";

import { Measured } from "../views/measured";
import type { UsageDay } from "./usage";

const GEOMETRY = { height: 180, left: 24, bottom: 24, top: 8 } as const;

function Bars({ days, limit, measured }: { readonly days: readonly UsageDay[]; readonly limit: number; readonly measured: number }) {
  const { height, left, bottom, top } = GEOMETRY;
  const width = Math.max(260, measured);
  const scale = Math.max(1, limit, ...days.map((day) => day.count));
  const bar = (width - left) / days.length;
  const Y = (value: number) => top + (1 - value / scale) * (height - top - bottom);
  return (
    <svg className="rh-usage-svg" viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label={`Indexes per day over ${days.length} days`}>
      {[0, scale].map((tick) => (
        <text key={tick} x={left - 8} y={Y(tick) + 4} textAnchor="end">
          {tick}
        </text>
      ))}
      <line className="rh-usage-axis" x1={left} x2={width} y1={Y(0)} y2={Y(0)} />
      <line className="rh-usage-limit" x1={left} x2={width} y1={Y(scale)} y2={Y(scale)} />
      {days.map((day, index) =>
        day.count === 0 ? null : (
          <rect
            key={index}
            className={day.today ? "rh-usage-today" : "rh-usage-bar"}
            x={left + index * bar + 4}
            y={Y(day.count)}
            width={Math.max(2, bar - 8)}
            height={Y(0) - Y(day.count)}
          />
        ),
      )}
      {days.map((day, index) =>
        index % 2 === 1 ? null : (
          <text key={index} x={left + index * bar + bar / 2} y={height - 6} textAnchor="middle">
            {day.dayOfMonth}
          </text>
        ),
      )}
    </svg>
  );
}

/** Indexes per UTC day, drawn at the width it is given, with the daily limit as a dashed line and today in the accent. */
export function UsageChart({ days, limit }: { readonly days: readonly UsageDay[]; readonly limit: number }) {
  return <Measured className="rh-usage-chart">{(width) => <Bars days={days} limit={limit} measured={width} />}</Measured>;
}
