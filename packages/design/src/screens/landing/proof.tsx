"use client";

import { useMemo, useState } from "react";
import { Text } from "../../components/feedback";
import type { LandingFigures } from "./figures-types";

const number = new Intl.NumberFormat("en-US");
const percent = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;

function Figure({ value, label }: { readonly value: string; readonly label: string }) {
  return (
    <div>
      <Text role="heading" figure>
        {value}
      </Text>
      <Text role="caption" tone="subtle">
        {label}
      </Text>
    </div>
  );
}

/** The repository in figures. Each one is a count the index recorded. */
export function ProofFigures({ figures }: { readonly figures: LandingFigures }) {
  const { counts } = figures;
  return (
    <div className="rh-ld-figs">
      <Figure value={number.format(counts.files)} label="files" />
      <Figure value={number.format(counts.nodes)} label="nodes" />
      <Figure value={number.format(counts.edges)} label="dependencies" />
      <Figure value={number.format(counts.regions)} label="regions" />
      <Figure value={percent(counts.preserveShare)} label="kept, of measured" />
    </div>
  );
}

type Kind = "kept" | "rebuilt" | "small";

interface Square {
  readonly kind: Kind;
  readonly name?: string;
  readonly score?: number;
}

const COLUMNS = 38;
const CELL = 16;
const SIZE = 12;

const KIND_WORD: Readonly<Record<Kind, string>> = { kept: "Kept as written", rebuilt: "Rebuilt from dependencies", small: "Too small to measure" };

/**
 * One square per region: kept, rebuilt, then the ones too small to measure. Kept is a filled square, rebuilt is hollow
 * with a dashed edge, too small is a small dot, so the three differ by shape and not by colour alone.
 */
export function RegionWaffle({ figures }: { readonly figures: LandingFigures }) {
  const { counts, regions } = figures;
  const squares = useMemo<Square[]>(() => {
    const measured = [...regions].sort((a, b) => a[5] - b[5] || b[4] - a[4] || (a[0] < b[0] ? -1 : 1));
    const list: Square[] = measured.map((row) => ({ kind: row[5] === 1 ? "kept" : "rebuilt", name: row[0], score: row[4] }));
    for (let index = 0; index < counts.degenerate; index += 1) list.push({ kind: "small" });
    return list;
  }, [regions, counts.degenerate]);
  const [picked, setPicked] = useState(-1);
  const rows = Math.ceil(squares.length / COLUMNS);
  const current = picked >= 0 ? squares[picked] : undefined;

  return (
    <div className="rh-ld-waffle-box">
      <svg
        className="rh-ld-waffle"
        viewBox={`0 0 ${COLUMNS * CELL} ${rows * CELL}`}
        role="img"
        aria-label={`${squares.length} squares, one per region of ${figures.repository}: ${counts.preserved} kept, ${counts.reconstructed} rebuilt, ${counts.degenerate} too small to measure`}
        onPointerLeave={() => setPicked(-1)}
      >
        {squares.map((square, index) => {
          const x = (index % COLUMNS) * CELL + (CELL - SIZE) / 2;
          const y = Math.floor(index / COLUMNS) * CELL + (CELL - SIZE) / 2;
          return (
            <g key={index} onPointerEnter={() => setPicked(index)} className={picked === index ? "rh-ld-sq-on" : undefined}>
              <rect x={x - 2} y={y - 2} width={SIZE + 4} height={SIZE + 4} fill="transparent" />
              {square.kind === "kept" ? <rect className="rh-ld-sq-kept" x={x} y={y} width={SIZE} height={SIZE} /> : null}
              {square.kind === "rebuilt" ? <rect className="rh-ld-sq-rebuilt" x={x + 1} y={y + 1} width={SIZE - 2} height={SIZE - 2} /> : null}
              {square.kind === "small" ? <rect className="rh-ld-sq-small" x={x + SIZE / 2 - 2} y={y + SIZE / 2 - 2} width={4} height={4} /> : null}
            </g>
          );
        })}
      </svg>
      <p className="rh-ld-tip rh-t-caption" aria-live="polite">
        {current === undefined
          ? "One square per region. Hover one for its score."
          : current.name === undefined
            ? KIND_WORD[current.kind]
            : `${current.name} · score ${current.score?.toFixed(3)} · ${KIND_WORD[current.kind].toLowerCase()}`}
      </p>
      <div className="rh-ld-legend rh-t-caption">
        <span>
          <i className="rh-ld-key-kept" />
          Kept as written
        </span>
        <span>
          <i className="rh-ld-key-rebuilt" />
          Rebuilt from dependencies
        </span>
        <span>
          <i className="rh-ld-key-small" />
          Too small to measure
        </span>
      </div>
    </div>
  );
}
