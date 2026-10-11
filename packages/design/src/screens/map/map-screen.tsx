"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { frameRect, type Camera, type Size } from "../../canvas/camera";
import type { ColorSource } from "../../canvas/colors";
import { useCanvasView } from "../../canvas/use-canvas-view";
import { Button } from "../../components/button";
import { Field } from "../../components/field";
import { KeyValueList } from "../../components/panel";
import { DecisionGlyph, DecisionTag } from "../../components/status";
import type { ViewBodies } from "../../contracts";
import { StatusLine, Workspace } from "../../frame/workspace";
import { Icon } from "../../icons/icons";
import { SelectionPanel } from "../canvas-views/selection-panel";
import { KIND_LABEL, drawMap, focusChain, type MapDrawState, type MapLengths } from "./draw";
import { buildMapModel, findCard, linksOf, type MapModel } from "./model";

export interface MapScreenProps {
  /** The `zoomMap` view body, loaded by the host. */
  readonly data: ViewBodies["zoomMap"];
  /** Where the canvas reads its colours from; tests only, a page leaves it out. */
  readonly colors?: ColorSource;
}

const WHOLE = { x: 0, y: 0, w: 1, h: 1 } as const;
const FIT_FILL = 0.94;
const CARD_FILL = 0.82;
const ZOOM_STEP = 1.5;
const number = new Intl.NumberFormat("en-US");

/** The lengths the canvas strokes with, read from the tokens once the page is on screen. */
function readLengths(): MapLengths {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string): number => Number.parseFloat(style.getPropertyValue(name)) || 0;
  return { radius: read("--rh-radius"), hairline: read("--rh-border"), emphasis: read("--rh-border-accent"), stroke: read("--rh-glyph-stroke") };
}

function ancestorsOf(model: MapModel, index: number): Set<number> {
  const found = new Set<number>();
  let parent = model.nodes[index]?.parent ?? -1;
  while (parent >= 0) {
    found.add(parent);
    parent = model.nodes[parent]?.parent ?? -1;
  }
  return found;
}

/**
 * The Map: the recorded hierarchy as nested cards. Zooming in opens a card into its children; hovering traces a card's
 * relations to its siblings; a click pins a card and the inspector says what the index recorded about it. The layout is
 * seeded by the index, so the same snapshot is always the same map.
 */
export function MapScreen({ data, colors }: MapScreenProps) {
  const model = useMemo(() => buildMapModel(data), [data]);
  const [selected, setSelected] = useState(-1);
  const [hovered, setHovered] = useState(-1);
  const [query, setQuery] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [lengths, setLengths] = useState<MapLengths>({ radius: 0, hairline: 0, emphasis: 0, stroke: 0 });
  const [chain, setChain] = useState<readonly number[]>([]);
  const [zoom, setZoom] = useState<number | undefined>();
  const sizeRef = useRef<Size>({ w: 0, h: 0 });

  useEffect(() => setLengths(readLengths()), []);

  const related = useMemo(() => new Set(selected < 0 ? [] : [...linksOf(model, selected).uses, ...linksOf(model, selected).usedBy].map((link) => link.other)), [model, selected]);
  const ancestors = useMemo(() => (selected < 0 ? new Set<number>() : ancestorsOf(model, selected)), [model, selected]);

  const view = useCanvasView<number>({
    draw: (frame) => {
      sizeRef.current = { w: frame.width, h: frame.height };
      const state: MapDrawState = { selected, hovered, related, ancestors, lengths };
      drawMap(frame, model, state);
    },
    fit: (size) => frameRect(WHOLE, size, FIT_FILL),
    onHover: (hit) => setHovered(hit ?? -1),
    onPick: (hit) => setSelected((current) => (hit === undefined || hit === current ? -1 : hit)),
    onOpen: (hit) => {
      const rect = model.rects[hit];
      if (rect !== undefined) view.frame(rect, CARD_FILL);
    },
    onCamera: (camera: Camera) => {
      setChain(focusChain(model, camera, sizeRef.current));
      const fitted = frameRect(WHOLE, sizeRef.current, FIT_FILL).scale;
      setZoom(fitted > 0 ? camera.scale / fitted : undefined);
    },
    onKey: (event) => {
      if (event.key !== "Escape") return false;
      setSelected(-1);
      return true;
    },
  }, colors);

  const { invalidate } = view;
  useEffect(() => {
    invalidate();
  }, [invalidate, selected, hovered, related, ancestors, lengths, model]);

  const goTo = (index: number): void => {
    setSelected(index);
    const rect = model.rects[index];
    if (rect !== undefined) view.frame(rect, CARD_FILL);
  };

  const find = (event: FormEvent): void => {
    event.preventDefault();
    const hit = findCard(model, query);
    setNotFound(hit < 0 && query.trim() !== "");
    if (hit >= 0) goTo(hit);
  };

  const shown = hovered >= 0 ? hovered : selected;
  const shownNode = shown >= 0 ? model.nodes[shown] : undefined;
  const picked = selected >= 0 ? model.nodes[selected] : undefined;
  const crumbs = chain.map((index) => model.nodes[index]?.name).filter((name): name is string => name !== undefined);

  const main =
    shownNode === undefined
      ? "Click the map to scroll-zoom. Double-click a card to open it."
      : `${KIND_LABEL[shownNode.kind]} · ${shownNode.name}${shownNode.files > 0 ? ` · ${number.format(shownNode.files)} files` : ""}${shownNode.decision === null ? "" : ` · ${shownNode.decision}`}`;

  const links = picked === undefined ? undefined : linksOf(model, picked.i);
  const linkRow = (other: number, count: number, direction: string) => (
    <li key={`${direction}:${other}`}>
      <button type="button" className="rh-map-link" onClick={() => goTo(other)}>
        <span className="rh-v-name">{model.nodes[other]?.name}</span>
        <span className="rh-mono rh-fg3">{number.format(count)}</span>
      </button>
    </li>
  );

  return (
    <>
      <Workspace
        inspector={
          picked === undefined ? undefined : (
            <SelectionPanel kind={KIND_LABEL[picked.kind]} title={picked.name} onClose={() => setSelected(-1)}>
              {picked.decision === null ? null : <DecisionTag decision={picked.decision} />}
              <KeyValueList
                className="rh-t-caption"
                items={[
                  { label: "Files", value: number.format(picked.files) },
                  { label: "Level", value: String(picked.level) },
                  ...(picked.path === "" ? [] : [{ label: "Path", value: <span className="rh-mono rh-map-path">{picked.path}</span> }]),
                ]}
              />
              {picked.summary === "" ? null : <p className="rh-t-caption rh-fg2">{picked.summary}</p>}
              {links === undefined || links.uses.length === 0 ? null : (
                <section>
                  <span className="rh-t-label">Uses</span>
                  <ul className="rh-map-links">{links.uses.slice(0, 8).map((link) => linkRow(link.other, link.count, "uses"))}</ul>
                </section>
              )}
              {links === undefined || links.usedBy.length === 0 ? null : (
                <section>
                  <span className="rh-t-label">Used by</span>
                  <ul className="rh-map-links">{links.usedBy.slice(0, 8).map((link) => linkRow(link.other, link.count, "used by"))}</ul>
                </section>
              )}
              <Button size="sm" onClick={() => goTo(picked.i)}>
                Zoom to this card
              </Button>
            </SelectionPanel>
          )
        }
      >
        <canvas ref={view.canvasRef} tabIndex={0} aria-label="Map of the repository. Scroll to zoom, drag to pan, arrow keys pan, plus and minus zoom, zero fits, Escape clears." />
        <form className="rh-map-tools" onSubmit={find} role="search">
          <Field icon="search" placeholder="Find a card" aria-label="Find a card" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
          <div className="rh-map-zoom" role="group" aria-label="Zoom">
            <Button type="button" size="sm" icon aria-label="Zoom in" onClick={() => view.zoomBy(ZOOM_STEP)}>
              <Icon name="plus" size={14} />
            </Button>
            <Button type="button" size="sm" icon aria-label="Zoom out" onClick={() => view.zoomBy(1 / ZOOM_STEP)}>
              <Icon name="minus" size={14} />
            </Button>
            <Button type="button" size="sm" icon aria-label="Fit the whole map" onClick={() => view.fit()}>
              <Icon name="fit" size={14} />
            </Button>
          </div>
          {notFound ? (
            <p className="rh-t-caption rh-fg3" role="status">
              Nothing is named like that.
            </p>
          ) : null}
        </form>
      </Workspace>
      <footer className="rh-statusbar">
        <StatusLine
          main={<span aria-live="polite">{main}</span>}
          aside={
            <>
              {crumbs.length === 0 ? null : <span className="rh-hide-sm">{crumbs.join(" › ")}</span>}
              <span className="rh-tag rh-hide-sm">
                <DecisionGlyph decision="kept" />
                kept
              </span>
              <span className="rh-tag rh-hide-sm">
                <DecisionGlyph decision="rebuilt" />
                rebuilt
              </span>
              {zoom === undefined ? null : <span className="rh-mono">{zoom.toFixed(1)}×</span>}
            </>
          }
        />
      </footer>
    </>
  );
}
