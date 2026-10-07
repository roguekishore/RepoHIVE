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
import type { Crumb } from "../../frame/app-frame";
import { StatusLine, Workspace } from "../../frame/workspace";
import { Icon } from "../../icons/icons";
import { routes } from "../../routes";
import { SelectionPanel } from "../canvas-views/selection-panel";
import type { DashboardFrame } from "../dashboard/frame-prop";
import { KIND_LABEL, drawMap, focusChain, type MapDrawState, type MapLengths } from "./draw";
import { buildMapModel, findCard, linksOf, type MapModel } from "./model";

export interface MapScreenProps {
  /** The `zoomMap` view body, loaded by the host. */
  readonly data: ViewBodies["zoomMap"];
  /** Where the canvas reads its colours from; tests only, a page leaves it out. */
  readonly colors?: ColorSource;
  /** The host's frame slot: the screen gives it the crumbs and the controls that belong in the header. */
  readonly Frame?: DashboardFrame;
  /** The repository the map shows; its name opens the crumbs. */
  readonly repository?: { readonly owner: string; readonly name: string };
}

const WHOLE = { x: 0, y: 0, w: 1, h: 1 } as const;
const FIT_FILL = 0.9;
const CARD_FILL = 0.86;
const ZOOM_STEP = 1.6;
const CRUMB_CHAIN = 3;
const number = new Intl.NumberFormat("en-US");

/** Without a host frame the controls render in place and the crumbs are not shown. */
const InlineFrame: DashboardFrame = ({ actions, children }) => (
  <>
    {actions}
    {children}
  </>
);

/** The lengths the canvas strokes with, read from the tokens once the page is on screen. */
function readLengths(): MapLengths {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string): number => Number.parseFloat(style.getPropertyValue(name)) || 0;
  return { radius: read("--rh-radius-lg"), hairline: read("--rh-border"), emphasis: read("--rh-border-accent"), stroke: read("--rh-glyph-stroke") };
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
 * seeded by the index, so the same snapshot is always the same map. The find field and zoom buttons sit in the header,
 * and the crumbs follow the zoom.
 */
export function MapScreen({ data, colors, Frame = InlineFrame, repository }: MapScreenProps) {
  const model = useMemo(() => buildMapModel(data), [data]);
  const [selected, setSelected] = useState(-1);
  const [hovered, setHovered] = useState(-1);
  const [query, setQuery] = useState("");
  const [notFound, setNotFound] = useState("");
  const [lengths, setLengths] = useState<MapLengths>({ radius: 0, hairline: 0, emphasis: 0, stroke: 0 });
  const [chain, setChain] = useState<readonly number[]>([]);
  const [zoom, setZoom] = useState<number | undefined>();
  const [active, setActive] = useState(false);
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
    onActive: setActive,
    onCamera: (camera: Camera) => {
      setChain((previous) => {
        const next = focusChain(model, camera, sizeRef.current);
        return previous.length === next.length && previous.every((index, position) => index === next[position]) ? previous : next;
      });
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
  const openCard = (index: number): void => {
    const rect = model.rects[index];
    if (rect !== undefined) view.frame(rect, CARD_FILL);
  };

  // The crumbs and the header controls are handed to the host's frame, which keeps them between renders by their text.
  // These handlers read the latest screen state through a ref so a crumb kept from an earlier render still works.
  const latest = useRef({ view, openCard });
  latest.current = { view, openCard };

  const find = (event: FormEvent): void => {
    event.preventDefault();
    const term = query.trim();
    const hit = findCard(model, query);
    setNotFound(hit < 0 && term !== "" ? term : "");
    if (hit >= 0) goTo(hit);
  };

  const shown = hovered >= 0 ? hovered : selected;
  const shownNode = shown >= 0 ? model.nodes[shown] : undefined;
  const picked = selected >= 0 ? model.nodes[selected] : undefined;

  const crumbs = useMemo<readonly Crumb[]>(() => {
    const shownChain = chain.length > CRUMB_CHAIN ? chain.slice(-CRUMB_CHAIN) : chain;
    const names = shownChain.map((index) => ({ index, name: model.nodes[index]?.name ?? "" }));
    return [
      ...(repository === undefined ? [] : [{ label: repository.name, href: routes.repoView(repository.owner, repository.name, "overview") }]),
      { label: "Map", onSelect: () => latest.current.view.fit() },
      ...(chain.length > CRUMB_CHAIN ? [{ label: "…", subtle: true }] : []),
      ...names.map(({ index, name }) => ({ label: name, onSelect: () => latest.current.openCard(index) })),
    ];
  }, [chain, model, repository]);

  const actions = (
    <>
      <form className="rh-map-find" onSubmit={find} role="search">
        <Field className="rh-find" icon="search" placeholder="Find, then Enter" aria-label="Find a card" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
      </form>
      <Button type="button" size="sm" icon aria-label="Zoom out" onClick={() => view.zoomBy(1 / ZOOM_STEP)}>
        <Icon name="minus" size={14} />
      </Button>
      <Button type="button" size="sm" icon aria-label="Zoom in" onClick={() => view.zoomBy(ZOOM_STEP)}>
        <Icon name="plus" size={14} />
      </Button>
      <Button type="button" size="sm" icon aria-label="Fit to view" onClick={() => view.fit()}>
        <Icon name="fit" size={14} />
      </Button>
    </>
  );

  const links = picked === undefined ? undefined : linksOf(model, picked.i);
  const linked =
    links === undefined
      ? []
      : [...links.uses.map((link) => ({ ...link, label: "uses" })), ...links.usedBy.map((link) => ({ ...link, label: "used by" }))].sort((a, b) => b.count - a.count).slice(0, 8);
  const relationCount = (index: number): number => {
    const found = linksOf(model, index);
    return found.uses.length + found.usedBy.length;
  };

  const root = model.nodes[0];
  const main =
    notFound !== ""
      ? `No card named "${notFound}"`
      : shownNode === undefined
        ? `${repository?.name ?? root?.name ?? "Repository"} · ${number.format(root?.files ?? 0)} files · ${number.format(model.nodes.length)} cards`
        : `${KIND_LABEL[shownNode.kind]} · ${shownNode.name} · ${number.format(relationCount(shownNode.i))} relations`;

  return (
    <Frame crumbs={crumbs} actions={actions} fill>
      <Workspace
        inspector={
          picked === undefined ? undefined : (
            <SelectionPanel kind={KIND_LABEL[picked.kind]} title={picked.name} onClose={() => setSelected(-1)}>
              {picked.decision === null ? null : <DecisionTag decision={picked.decision} />}
              <KeyValueList
                className="rh-t-caption"
                items={[
                  { label: "Files", value: number.format(picked.files) },
                  { label: "Uses", value: number.format(links?.uses.length ?? 0) },
                  { label: "Used by", value: number.format(links?.usedBy.length ?? 0) },
                ]}
              />
              {linked.length === 0 ? null : (
                <div className="rh-insp-linked">
                  <span className="rh-t-label">Linked</span>
                  <ul>
                    {linked.map((link) => (
                      <li key={`${link.label}:${link.other}`}>
                        <button type="button" onClick={() => goTo(link.other)}>
                          <span>{model.nodes[link.other]?.name}</span>
                          <em>{link.label}</em>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {picked.kids.length === 0 ? null : (
                <Button size="sm" onClick={() => openCard(picked.i)}>
                  Open
                </Button>
              )}
            </SelectionPanel>
          )
        }
      >
        <canvas ref={view.canvasRef} tabIndex={0} aria-label="Map of the repository. Scroll to zoom, drag to pan, arrow keys pan, plus and minus zoom, zero fits, Escape clears." />
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
              <span className="rh-hide-sm">{active ? "Scroll zoom · drag pan · double-click opens" : "Click the map to scroll-zoom"}</span>
              <span className="rh-mono">{zoom === undefined ? "100%" : `${number.format(Math.round(zoom * 100))}%`}</span>
            </>
          }
        />
      </footer>
    </Frame>
  );
}
