"use client";

import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { LinkButton } from "../../components/button";
import { DecisionGlyph, DecisionTag, type Decision } from "../../components/status";
import { KeyValueList } from "../../components/panel";
import { StatusLine, Workspace } from "../../frame/workspace";
import { routes } from "../../routes";
import { decisionOf, formatCount, regionName } from "./names";
import { SelectionPanel } from "./selection-panel";
import { arcPath, buildArcTree, sunLayout, sunState, type HierarchyArc, type SunLayout, type SunState } from "./sunburst";
import { useElementSize } from "./use-element-size";
import type { HierarchyScale } from "./view-types";

export interface HierarchyScreenProps {
  readonly owner: string;
  readonly name: string;
  /** The `hierarchyScale` view body, loaded by the host. */
  readonly data: HierarchyScale;
}

const STATE_WORD: Record<SunState, string> = {
  wrapper: "wrapper",
  kept: "kept",
  rebuilt: "rebuilt",
  unassessed: "not assessed",
};

/** What the arc is called: its region's label, a file's path, or what kind of group it is. */
export function arcName(arc: HierarchyArc): string {
  if (arc.label !== "") return arc.label;
  if (arc.id.startsWith("file:")) return arc.id.slice("file:".length);
  return arc.wrapper ? "Wrapper group" : "Group";
}

function stateWord(arc: HierarchyArc): string {
  const state = sunState(arc);
  return state === "wrapper" && !arc.wrapper ? "no decision recorded" : STATE_WORD[state];
}

interface ArcsProps {
  readonly arcs: readonly HierarchyArc[];
  readonly layout: SunLayout;
}

/** Every arc. Memoised on the arcs and the layout, so a hover or a selection does not redraw thousands of paths. */
const Arcs = memo(function Arcs({ arcs, layout }: ArcsProps) {
  return (
    <g>
      {arcs.map((arc, index) => (
        <path
          key={arc.id}
          d={arcPath(layout, arc.level, arc.start, arc.span)}
          data-a={index}
          className={`rh-arc rh-arc-${sunState(arc)}`}
        />
      ))}
    </g>
  );
});

/** The hierarchy as a sunburst: radius is depth, sweep is files, fill and hatch are the recorded decision. */
export function HierarchyScreen({ owner, name, data }: HierarchyScreenProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(stageRef);
  const [selected, setSelected] = useState(-1);
  const [hovered, setHovered] = useState(-1);

  const tree = useMemo(() => buildArcTree(data.arcs), [data.arcs]);
  const layout = useMemo(() => sunLayout(width, height, data.maxLevel), [width, height, data.maxLevel]);
  const ready = width >= 10 && height >= 10;

  const arcAt = (target: EventTarget | null): number => {
    if (!(target instanceof Element)) return -1;
    const holder = target.closest("[data-a]");
    return holder === null ? -1 : Number(holder.getAttribute("data-a"));
  };

  const onClick = (event: MouseEvent): void => {
    const index = arcAt(event.target);
    setSelected((current) => (index === current ? -1 : index));
  };

  const onKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      const move = (to: number | undefined): void => {
        if (to !== undefined && to >= 0) {
          event.preventDefault();
          setSelected(to);
        }
      };
      if (event.key === "Escape") {
        setSelected(-1);
        return;
      }
      if (selected < 0) {
        if (event.key.startsWith("Arrow")) move(tree.roots[0]);
        return;
      }
      if (event.key === "ArrowRight") move(tree.next[selected]);
      else if (event.key === "ArrowLeft") move(tree.previous[selected]);
      else if (event.key === "ArrowUp") move(tree.parent[selected]);
      else if (event.key === "ArrowDown") move(tree.firstChild[selected]);
    },
    [selected, tree],
  );

  const shown = hovered >= 0 ? hovered : selected;
  const shownArc = shown >= 0 ? data.arcs[shown] : undefined;
  const picked = selected >= 0 ? data.arcs[selected] : undefined;

  const main =
    shownArc === undefined
      ? `Radius is depth, sweep is files, fill and hatch are the decision · ${formatCount(data.totalFiles)} files in ${formatCount(data.arcs.length)} arcs`
      : `Level ${shownArc.level} · ${arcName(shownArc)} · ${formatCount(shownArc.files)} files · ${stateWord(shownArc)}`;

  return (
    <>
      <Workspace
        inspector={
          picked === undefined ? undefined : <ArcInspector arc={picked} owner={owner} name={name} onClose={() => setSelected(-1)} />
        }
      >
        <div ref={stageRef} className="rh-sun-stage">
          {ready ? (
            <svg
              className="rh-sun"
              viewBox={`0 0 ${width} ${height}`}
              role="application"
              aria-label="Sunburst of the hierarchy. Arrow keys move between arcs, Escape clears."
              tabIndex={0}
              onClick={onClick}
              onKeyDown={onKeyDown}
              onMouseOver={(event) => setHovered(arcAt(event.target))}
              onMouseLeave={() => setHovered(-1)}
            >
              <defs>
                <pattern id="rh-sun-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                  <rect className="rh-sun-hatch-fill" width="6" height="6" />
                  <line className="rh-sun-hatch-line" x1="0" y1="0" x2="0" y2="6" />
                </pattern>
              </defs>
              <circle className="rh-sun-hub" cx={layout.cx} cy={layout.cy} r={Math.max(0, layout.hub - 2)} />
              <Arcs arcs={data.arcs} layout={layout} />
              {picked === undefined ? null : (
                <path className="rh-arc-on" d={arcPath(layout, picked.level, picked.start, picked.span)} pointerEvents="none" />
              )}
              <text className="rh-sun-count" x={layout.cx} y={layout.cy - 2} textAnchor="middle">
                {formatCount(data.totalFiles)}
              </text>
              <text className="rh-sun-unit" x={layout.cx} y={layout.cy + 18} textAnchor="middle">
                files
              </text>
            </svg>
          ) : null}
        </div>
      </Workspace>
      <footer className="rh-statusbar">
        <StatusLine
          main={<span aria-live="polite">{main}</span>}
          aside={
            <>
              <span className="rh-tag rh-hide-sm">
                <DecisionGlyph decision="kept" />
                kept
              </span>
              <span className="rh-tag rh-hide-sm">
                <DecisionGlyph decision="rebuilt" />
                rebuilt
              </span>
              <span className="rh-tag rh-hide-sm">
                <DecisionGlyph decision="unassessed" />
                not assessed
              </span>
              <span className="rh-hide-sm">{formatCount(data.omittedArcs)} small arcs omitted</span>
            </>
          }
        />
      </footer>
    </>
  );
}

function ArcInspector({
  arc,
  owner,
  name,
  onClose,
}: {
  readonly arc: HierarchyArc;
  readonly owner: string;
  readonly name: string;
  readonly onClose: () => void;
}) {
  const decision: Decision | undefined = decisionOf(arc.state);
  return (
    <SelectionPanel kind={`Level ${arc.level}`} title={arcName(arc)} onClose={onClose}>
      {decision === undefined || arc.wrapper ? null : <DecisionTag decision={decision} />}
      <KeyValueList
        className="rh-t-caption"
        items={[
          { label: "Files", value: formatCount(arc.files) },
          ...(arc.regionId === null ? [] : [{ label: "Region", value: regionName(arc.regionId) }]),
        ]}
      />
      {arc.regionId === null ? null : (
        <LinkButton size="sm" href={`${routes.repoView(owner, name, "decision-audit")}?region=${encodeURIComponent(arc.regionId)}`}>
          Show in Decisions
        </LinkButton>
      )}
    </SelectionPanel>
  );
}
