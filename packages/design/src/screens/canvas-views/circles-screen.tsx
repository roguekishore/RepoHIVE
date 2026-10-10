"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { frameRect } from "../../canvas/camera";
import type { ColorSource } from "../../canvas/colors";
import { rgbaCss } from "../../canvas/colors";
import { fitText } from "../../canvas/text";
import { useCanvasView } from "../../canvas/use-canvas-view";
import { Button } from "../../components/button";
import { Field } from "../../components/field";
import { KeyValueList } from "../../components/panel";
import { DecisionGlyph, DecisionTag } from "../../components/status";
import { StatusLine, Workspace } from "../../frame/workspace";
import { Icon } from "../../icons/icons";
import type { ColorToken } from "../../tokens/names";
import { KIND_LABEL } from "../map/draw";
import { findCard, linksOf } from "../map/model";
import { buildCircleModel, pathTo } from "./circle-model";
import { SelectionPanel } from "./selection-panel";
import type { ZoomMapBody } from "./view-types";

export interface CirclesScreenProps {
  /** The `zoomMap` view body, loaded by the host. */
  readonly data: ZoomMapBody;
  /** Where the canvas reads its colours from; tests only, a page leaves it out. */
  readonly colors?: ColorSource;
}

const FIT_FILL = 0.94;
const CIRCLE_FILL = 0.82;
const ZOOM_STEP = 1.5;
const LINKS_SHOWN = 8;
const number = new Intl.NumberFormat("en-US");

interface Lengths {
  readonly hairline: number;
  readonly emphasis: number;
  readonly stroke: number;
}

function readLengths(): Lengths {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string): number => Number.parseFloat(style.getPropertyValue(name)) || 0;
  return { hairline: read("--rh-border"), emphasis: read("--rh-border-accent"), stroke: read("--rh-glyph-stroke") };
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Circles: the same hierarchy as the Map, drawn as circles inside circles. A circle shows its name until it is big
 * enough on screen to open into its children. Links are drawn only for the circle you pin: solid for what it uses,
 * dashed for what uses it, each running to whatever circle is showing at the current zoom.
 */
export function CirclesScreen({ data, colors }: CirclesScreenProps) {
  const model = useMemo(() => buildCircleModel(data), [data]);
  const [selected, setSelected] = useState(-1);
  const [hovered, setHovered] = useState(-1);
  const [query, setQuery] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [lengths, setLengths] = useState<Lengths>({ hairline: 0, emphasis: 0, stroke: 0 });
  const [active, setActive] = useState(false);

  useEffect(() => setLengths(readLengths()), []);

  const view = useCanvasView<number>(
    {
      draw: (frame) => {
        const { ctx, palette, camera, width, height, hits, text } = frame;
        const colour = (token: ColorToken, alpha = 1): string => rgbaCss(palette.colors[token], alpha);
        const sx = (x: number): number => width / 2 + (x - camera.cx) * camera.scale;
        const sy = (y: number): number => height / 2 + (y - camera.cy) * camera.scale;
        const start = Math.min(width, height) * 0.14;
        const end = Math.min(width, height) * 0.3;
        const alpha = new Map<number, number>();
        const shown = new Set<number>();

        for (const id of model.order) {
          const circle = model.circles[id];
          if (circle === undefined) continue;
          const inherited = circle.parent < 0 ? 1 : (alpha.get(circle.parent) ?? 0);
          const parentCircle = circle.parent < 0 ? undefined : model.circles[circle.parent];
          const parentOpen = parentCircle === undefined ? 1 : clamp01((parentCircle.r * camera.scale - start) / (end - start));
          const visible = circle.parent < 0 ? 1 : inherited * parentOpen;
          alpha.set(id, visible);
          if (visible <= 0.02) continue;
          const x = sx(circle.x);
          const y = sy(circle.y);
          const R = circle.r * camera.scale;
          if (x + R < 0 || y + R < 0 || x - R > width || y - R > height || R < 1.5) continue;
          shown.add(id);

          const node = model.map.nodes[id];
          const open = circle.kids.length === 0 ? 0 : clamp01((R - start) / (end - start));
          ctx.globalAlpha = visible;
          ctx.fillStyle = colour("surface", 0.55 + 0.45 * (1 - open));
          ctx.beginPath();
          ctx.arc(x, y, R, 0, Math.PI * 2);
          ctx.fill();

          const isSelected = id === selected;
          ctx.lineWidth = isSelected ? lengths.emphasis : lengths.hairline;
          ctx.strokeStyle = isSelected ? colour("accent") : id === hovered ? colour("fg") : node?.decision === "rebuilt" ? colour("rebuilt") : colour("fg-3");
          ctx.setLineDash(node?.decision === "rebuilt" ? [lengths.stroke * 3, lengths.stroke * 2] : []);
          ctx.stroke();
          ctx.setLineDash([]);

          if (R >= 3) hits.addCircle(x, y, R, id, circle.depth);

          // The name: centred on a face, tucked under the rim once the circle has opened.
          if (R >= 18) {
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = `600 ${text.caption}px ${palette.sans}`;
            ctx.fillStyle = colour("fg", visible * (open >= 0.5 ? 0.8 : 1));
            const label = fitText(ctx, circle.label, R * (open > 0 ? 1.1 : 1.6));
            ctx.fillText(label, x, open > 0 ? y - R * 0.93 + text.caption : y - (R >= 34 ? text.caption * 0.4 : 0));
            if (open < 0.5 && R >= 34 && node !== undefined && node.files > 0) {
              ctx.font = `400 ${text.label}px ${palette.mono}`;
              ctx.fillStyle = colour("fg-3", visible);
              ctx.fillText(`${number.format(node.files)} ${node.files === 1 ? "file" : "files"}`, x, y + text.caption * 0.9);
            }
          }
        }
        ctx.globalAlpha = 1;

        // What the pinned circle uses (solid) and what uses it (dashed), to whichever circle is showing.
        if (selected >= 0) {
          const from = model.circles[selected];
          if (from !== undefined) {
            ctx.strokeStyle = colour("accent", 0.85);
            ctx.lineWidth = lengths.emphasis;
            for (const card of pathTo(model, selected)) {
              const links = linksOf(model.map, card);
              for (const [dashed, list] of [[false, links.uses], [true, links.usedBy]] as const) {
                ctx.setLineDash(dashed ? [lengths.stroke * 3, lengths.stroke * 2] : []);
                ctx.beginPath();
                for (const link of list) {
                  const target = model.circleOf[link.other];
                  const to = target === undefined || target < 0 ? undefined : model.circles[target];
                  if (to === undefined || !shown.has(to.id) || to.id === selected) continue;
                  ctx.moveTo(sx(from.x), sy(from.y));
                  ctx.lineTo(sx(to.x), sy(to.y));
                }
                ctx.stroke();
              }
            }
            ctx.setLineDash([]);
          }
        }
      },
      fit: (size) => frameRect({ x: 0, y: 0, w: 1, h: 1 }, size, FIT_FILL),
      onHover: (hit) => setHovered(hit ?? -1),
      onPick: (hit) => setSelected((current) => (hit === undefined || hit === current ? -1 : hit)),
      onOpen: (hit) => zoomTo(hit),
      onActive: setActive,
      onKey: (event) => {
        if (event.key !== "Escape") return false;
        setSelected(-1);
        return true;
      },
    },
    colors,
  );

  function zoomTo(id: number): void {
    const circle = model.circles[id];
    if (circle !== undefined) view.frame({ x: circle.x - circle.r, y: circle.y - circle.r, w: circle.r * 2, h: circle.r * 2 }, CIRCLE_FILL);
  }

  const { invalidate } = view;
  useEffect(() => {
    invalidate();
  }, [invalidate, selected, hovered, lengths, model]);

  const goTo = (id: number): void => {
    setSelected(id);
    zoomTo(id);
  };

  const find = (event: FormEvent): void => {
    event.preventDefault();
    const card = findCard(model.map, query);
    const circle = card < 0 ? -1 : (model.circleOf[card] ?? -1);
    setNotFound(circle < 0 && query.trim() !== "");
    if (circle >= 0) goTo(circle);
  };

  const shownId = hovered >= 0 ? hovered : selected;
  const shownCircle = shownId >= 0 ? model.circles[shownId] : undefined;
  const shownNode = shownId >= 0 ? model.map.nodes[shownId] : undefined;
  const picked = selected >= 0 ? model.circles[selected] : undefined;
  const pickedNode = selected >= 0 ? model.map.nodes[selected] : undefined;
  const links = pickedNode === undefined ? undefined : linksOf(model.map, pickedNode.i);

  const main =
    shownCircle === undefined || shownNode === undefined
      ? "Click the graph to scroll-zoom. Double-click a circle to open it."
      : `${KIND_LABEL[shownNode.kind]} · ${shownCircle.label} · ${number.format(shownNode.files)} files${shownNode.decision === null ? "" : ` · ${shownNode.decision}`}`;

  const linkRow = (other: number, count: number, direction: string) => {
    const circle = model.circleOf[other];
    return (
      <li key={`${direction}:${other}`}>
        <button type="button" className="rh-flat-link" onClick={() => (circle !== undefined && circle >= 0 ? goTo(circle) : undefined)}>
          <span className="rh-v-name">{model.map.nodes[other]?.name}</span>
          <em className="rh-fg3">{number.format(count)} imports</em>
        </button>
      </li>
    );
  };

  return (
    <>
      <Workspace
        inspector={
          picked === undefined || pickedNode === undefined ? undefined : (
            <SelectionPanel kind={KIND_LABEL[pickedNode.kind]} title={picked.label} onClose={() => setSelected(-1)}>
              {pickedNode.decision === null ? null : <DecisionTag decision={pickedNode.decision} />}
              <KeyValueList
                className="rh-t-caption"
                items={[
                  { label: "Files", value: number.format(pickedNode.files) },
                  { label: "Inside", value: number.format(picked.kids.length + picked.omitted) },
                  ...(pickedNode.path === "" ? [] : [{ label: "Path", value: <span className="rh-mono rh-flat-path">{pickedNode.path}</span> }]),
                ]}
              />
              {picked.omitted === 0 ? null : (
                <p className="rh-t-caption rh-fg3">
                  {number.format(picked.omitted)} of its smallest circles are not drawn; the Map shows every card.
                </p>
              )}
              {links === undefined || links.uses.length === 0 ? null : (
                <section>
                  <span className="rh-t-label">Uses (solid)</span>
                  <ul className="rh-flat-links">{links.uses.slice(0, LINKS_SHOWN).map((link) => linkRow(link.other, link.count, "uses"))}</ul>
                </section>
              )}
              {links === undefined || links.usedBy.length === 0 ? null : (
                <section>
                  <span className="rh-t-label">Used by (dashed)</span>
                  <ul className="rh-flat-links">{links.usedBy.slice(0, LINKS_SHOWN).map((link) => linkRow(link.other, link.count, "used by"))}</ul>
                </section>
              )}
              <Button size="sm" onClick={() => zoomTo(picked.id)}>
                Zoom to this circle
              </Button>
            </SelectionPanel>
          )
        }
      >
        <canvas ref={view.canvasRef} tabIndex={0} aria-label="Circle graph of the repository. Click to focus, scroll to zoom, drag to pan, arrow keys pan, plus and minus zoom, zero fits, Escape clears." />
        <form className="rh-map-tools" onSubmit={find} role="search">
          <Field icon="search" placeholder="Find a circle" aria-label="Find a circle" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
          <div className="rh-map-zoom" role="group" aria-label="Zoom">
            <Button type="button" size="sm" icon aria-label="Zoom in" onClick={() => view.zoomBy(ZOOM_STEP)}>
              <Icon name="plus" size={14} />
            </Button>
            <Button type="button" size="sm" icon aria-label="Zoom out" onClick={() => view.zoomBy(1 / ZOOM_STEP)}>
              <Icon name="minus" size={14} />
            </Button>
            <Button type="button" size="sm" icon aria-label="Fit the whole graph" onClick={() => view.fit()}>
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
              <span className="rh-tag rh-hide-sm">
                <DecisionGlyph decision="kept" />
                kept
              </span>
              <span className="rh-tag rh-hide-sm">
                <DecisionGlyph decision="rebuilt" />
                rebuilt
              </span>
              <span className="rh-hide-sm">{active ? "Scroll zoom · drag pan · click a circle" : "Click the graph to scroll-zoom"}</span>
            </>
          }
        />
      </footer>
    </>
  );
}
