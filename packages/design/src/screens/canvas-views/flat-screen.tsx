"use client";

import { useEffect, useMemo, useState } from "react";
import { frameRect } from "../../canvas/camera";
import type { ColorSource } from "../../canvas/colors";
import { rgbaCss } from "../../canvas/colors";
import { useCanvasView } from "../../canvas/use-canvas-view";
import { Button } from "../../components/button";
import { KeyValueList } from "../../components/panel";
import { StatusLine, Workspace } from "../../frame/workspace";
import { Icon } from "../../icons/icons";
import type { ColorToken } from "../../tokens/names";
import { fitText } from "../../canvas/text";
import { FLAT_WORLD, buildFlatGraph, placeFlatGraph } from "./flat-model";
import { SelectionPanel } from "./selection-panel";
import type { GraphBody } from "./view-types";

export interface FlatScreenProps {
  /** The `graph` view body, loaded by the host. */
  readonly data: GraphBody;
  /** Where the canvas reads its colours from; tests only, a page leaves it out. */
  readonly colors?: ColorSource;
}

const FIT_FILL = 0.94;
const ZOOM_STEP = 1.5;
const LINKED_SHOWN = 10;
const number = new Intl.NumberFormat("en-US");

interface Lengths {
  readonly hairline: number;
  readonly emphasis: number;
  readonly radius: number;
}

function readLengths(): Lengths {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string): number => Number.parseFloat(style.getPropertyValue(name)) || 0;
  return { hairline: read("--rh-border"), emphasis: read("--rh-border-accent"), radius: read("--rh-radius") };
}

/**
 * The Baseline: every file and every import as one flat graph, with no hierarchy, so the hierarchy has something to be
 * compared with. The layout is seeded by the recorded graph; hovering a file lights its links, a click pins it.
 */
export function FlatScreen({ data, colors }: FlatScreenProps) {
  const graph = useMemo(() => buildFlatGraph(data), [data]);
  const placement = useMemo(() => placeFlatGraph(graph), [graph]);
  const [selected, setSelected] = useState(-1);
  const [hovered, setHovered] = useState(-1);
  const [lengths, setLengths] = useState<Lengths>({ hairline: 0, emphasis: 0, radius: 0 });
  const [active, setActive] = useState(false);

  useEffect(() => setLengths(readLengths()), []);

  const view = useCanvasView<number>(
    {
      draw: (frame) => {
        const { ctx, palette, camera, width, height, hits } = frame;
        const colour = (token: ColorToken, alpha = 1): string => rgbaCss(palette.colors[token], alpha);
        const sx = (i: number): number => width / 2 + ((placement.x[i] ?? 0) - camera.cx) * camera.scale;
        const sy = (i: number): number => height / 2 + ((placement.y[i] ?? 0) - camera.cy) * camera.scale;
        const lit = (i: number, around: number): boolean => i === around || (graph.adjacent[around]?.includes(i) ?? false);

        // Every import, faint; dimmer still while a file is pinned.
        ctx.lineWidth = lengths.hairline;
        ctx.strokeStyle = colour("fg-3", selected >= 0 ? 0.05 : 0.14);
        ctx.beginPath();
        for (const [a, b] of graph.imports) {
          ctx.moveTo(sx(a), sy(a));
          ctx.lineTo(sx(b), sy(b));
        }
        ctx.stroke();

        const edgesOf = (i: number, token: "fg-3" | "accent", line: number): void => {
          ctx.strokeStyle = colour(token);
          ctx.lineWidth = line;
          ctx.beginPath();
          for (const j of graph.adjacent[i] ?? []) {
            ctx.moveTo(sx(i), sy(i));
            ctx.lineTo(sx(j), sy(j));
          }
          ctx.stroke();
        };
        if (hovered >= 0 && hovered !== selected) edgesOf(hovered, "fg-3", lengths.hairline * 2);
        if (selected >= 0) edgesOf(selected, "accent", lengths.emphasis);

        // Files: the unlit ones first, so the lit ones sit on top while something is pinned.
        const scale = Math.max(1, Math.min(2.5, camera.scale * 1.6));
        for (let pass = 0; pass < 2; pass += 1) {
          for (let i = 0; i < graph.ids.length; i += 1) {
            const isLit = selected < 0 || lit(i, selected) || i === hovered || (hovered >= 0 && lit(i, hovered));
            if (selected >= 0 && (pass === 0) === isLit) continue;
            if (selected < 0 && pass === 1) continue;
            const x = sx(i);
            const y = sy(i);
            if (x < -8 || y < -8 || x > width + 8 || y > height + 8) continue;
            const degree = graph.adjacent[i]?.length ?? 0;
            const r = (1.2 + Math.sqrt(degree) * 0.45) * scale;
            ctx.globalAlpha = selected >= 0 && !isLit ? 0.18 : 1;
            ctx.fillStyle = i === selected ? colour("accent") : isLit && (selected >= 0 || i === hovered) ? colour("fg") : colour("fg-3");
            ctx.beginPath();
            ctx.arc(x, y, i === selected ? r + lengths.emphasis : r, 0, Math.PI * 2);
            ctx.fill();
            hits.addCircle(x, y, Math.max(r, lengths.radius * 2), i);
          }
        }
        ctx.globalAlpha = 1;

        // The name of the pinned file and of the one under the pointer, in a small label above its dot.
        ctx.font = `500 ${frame.text.caption}px ${palette.sans}`;
        ctx.textBaseline = "bottom";
        ctx.textAlign = "center";
        [selected, hovered].forEach((i, order) => {
          if (i < 0 || (order === 1 && i === selected)) return;
          const text = fitText(ctx, graph.names[i] ?? "", width * 0.6);
          const w = ctx.measureText(text).width + 12;
          const x = sx(i);
          const y = sy(i) - 8;
          ctx.fillStyle = colour("surface");
          ctx.strokeStyle = colour("line-strong");
          ctx.lineWidth = lengths.hairline;
          ctx.beginPath();
          ctx.rect(x - w / 2, y - 20, w, 20);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = order === 0 ? colour("accent") : colour("fg");
          ctx.fillText(text, x, y - 3);
        });
      },
      fit: (size) => frameRect({ x: 0, y: 0, w: FLAT_WORLD, h: FLAT_WORLD }, size, FIT_FILL),
      limits: { minScale: 0.1, maxScale: 40 },
      onHover: (hit) => setHovered(hit ?? -1),
      onPick: (hit) => setSelected((current) => (hit === undefined || hit === current ? -1 : hit)),
      onActive: setActive,
      onKey: (event) => {
        if (event.key !== "Escape") return false;
        setSelected(-1);
        return true;
      },
    },
    colors,
  );

  const { invalidate } = view;
  useEffect(() => {
    invalidate();
  }, [invalidate, selected, hovered, lengths, graph, placement]);

  const shown = hovered >= 0 ? hovered : selected;
  const main =
    shown < 0
      ? `${number.format(graph.ids.length)} files · ${number.format(graph.imports.length)} imports`
      : `${graph.names[shown]} · ${graph.folders[shown] === "" ? "root" : graph.folders[shown]} · ${number.format(graph.adjacent[shown]?.length ?? 0)} links`;

  const linked = useMemo(() => {
    if (selected < 0) return [];
    return [...(graph.adjacent[selected] ?? [])].sort((a, b) => (graph.adjacent[b]?.length ?? 0) - (graph.adjacent[a]?.length ?? 0) || a - b).slice(0, LINKED_SHOWN);
  }, [graph, selected]);

  return (
    <>
      <Workspace
        inspector={
          selected < 0 ? undefined : (
            <SelectionPanel kind="File" title={graph.names[selected]} onClose={() => setSelected(-1)}>
              <KeyValueList
                className="rh-t-caption"
                items={[
                  { label: "Module", value: <span className="rh-mono rh-flat-path">{graph.folders[selected] === "" ? "root" : graph.folders[selected]}</span> },
                  { label: "Links", value: number.format(graph.adjacent[selected]?.length ?? 0) },
                ]}
              />
              {linked.length === 0 ? null : (
                <section>
                  <span className="rh-t-label">Linked</span>
                  <ul className="rh-flat-links">
                    {linked.map((index) => (
                      <li key={index}>
                        <button type="button" className="rh-flat-link" onClick={() => setSelected(index)} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(-1)}>
                          <span className="rh-v-name">{graph.names[index]}</span>
                          <em className="rh-fg3">{graph.folders[index]}</em>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </SelectionPanel>
          )
        }
      >
        <canvas ref={view.canvasRef} tabIndex={0} aria-label="Flat dependency graph of the repository's files. Click to focus, scroll to zoom, drag to pan, arrow keys pan, Escape clears." />
        <div className="rh-flat-zoom" role="group" aria-label="Zoom">
          <Button type="button" size="sm" icon aria-label="Zoom out" onClick={() => view.zoomBy(1 / ZOOM_STEP)}>
            <Icon name="minus" size={14} />
          </Button>
          <Button type="button" size="sm" icon aria-label="Zoom in" onClick={() => view.zoomBy(ZOOM_STEP)}>
            <Icon name="plus" size={14} />
          </Button>
          <Button type="button" size="sm" icon aria-label="Fit to view" onClick={() => view.fit()}>
            <Icon name="fit" size={14} />
          </Button>
        </div>
      </Workspace>
      <footer className="rh-statusbar">
        <StatusLine
          main={<span aria-live="polite">{main}</span>}
          aside={
            <>
              <span className="rh-hide-sm">Every file and import, no hierarchy</span>
              <span className="rh-hide-sm">{active ? "Scroll zoom · drag pan · click a file" : "Click the graph to scroll-zoom"}</span>
            </>
          }
        />
      </footer>
    </>
  );
}
