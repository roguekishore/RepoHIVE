"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type Sigma from "sigma";
import type Graph from "graphology";
import { Maximize, Pause, Play, ZoomIn, ZoomOut } from "lucide-react";
import { resolveToken, useCommunityFamilies, useThemeVersion } from "@/lib/theme-tokens";
import type { FlatGraph } from "./graph-model";

export interface FlatGraphCanvasHandle {
  focusNode: (id: string) => void;
}

interface FlatGraphCanvasProps {
  graph: FlatGraph;
  selected: string | null;
  /** Files a search matched; everything else fades. `null` when not searching. */
  matches: Set<string> | null;
  /** Files outside the chosen module; they fade. `null` when no module is chosen. */
  faded: Set<string> | null;
  onSelect: (id: string | null) => void;
}

interface Palette {
  fade: string;
  accent: string;
  text: string;
  edge: string;
}

/** What the Sigma reducers read. A ref, so a hover repaints without re-rendering React. */
interface View {
  hovered: string | null;
  selected: string | null;
  matches: Set<string> | null;
  faded: Set<string> | null;
  neighbours: Set<string>;
  palette: Palette;
}

function readPalette(): Palette {
  return {
    fade: resolveToken("--color-border-default", "gray"),
    accent: resolveToken("--color-accent-primary", "mediumpurple"),
    text: resolveToken("--color-text-secondary", "gray"),
    edge: resolveToken("--color-border-default", "gray"),
  };
}

function layoutSettings(order: number): Record<string, unknown> {
  const tier = order < 500 ? 0 : order < 2000 ? 1 : order < 10000 ? 2 : 3;
  return {
    gravity: [0.8, 0.5, 0.3, 0.2][tier],
    scalingRatio: [12, 20, 30, 40][tier],
    slowDown: [10, 12, 15, 20][tier],
    barnesHutOptimize: order > 200,
    barnesHutTheta: tier >= 2 ? 0.8 : 0.6,
    adjustSizes: true,
    outboundAttractionDistribution: true,
  };
}

const layoutMillis = (order: number) => (order > 2000 ? 12000 : 8000);

export const FlatGraphCanvas = forwardRef<FlatGraphCanvasHandle, FlatGraphCanvasProps>(function FlatGraphCanvas(
  { graph, selected, matches, faded, onSelect },
  ref,
) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [sigma, setSigma] = useState<Sigma | null>(null);
  const [arranging, setArranging] = useState(false);
  const themeVersion = useThemeVersion();
  const families = useCommunityFamilies();

  const view = useRef<View>({
    hovered: null,
    selected,
    matches,
    faded,
    neighbours: new Set(),
    palette: readPalette(),
  });
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const layout = useRef<{ stop: () => void; kill: () => void } | null>(null);
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutRun = useRef(0);

  const refresh = useCallback(() => sigma?.refresh({ skipIndexation: true }), [sigma]);

  const syncFocus = useCallback(() => {
    const v = view.current;
    const focus = v.hovered ?? v.selected;
    v.neighbours = focus !== null && graph.hasNode(focus) ? new Set(graph.neighbors(focus)) : new Set();
  }, [graph]);

  // Selection, search and module filter arrive as props.
  useEffect(() => {
    Object.assign(view.current, { selected, matches, faded });
    syncFocus();
    refresh();
  }, [selected, matches, faded, syncFocus, refresh]);

  // Colours depend on the theme, so they are written onto the graph here rather than at build time.
  const paint = useCallback(() => {
    const palette = readPalette();
    view.current.palette = palette;
    graph.forEachNode((id, attrs) => graph.setNodeAttribute(id, "color", families(attrs.community).hub || palette.accent));
    graph.forEachEdge((id) => graph.setEdgeAttribute(id, "color", palette.edge));
  }, [graph, families]);

  useEffect(() => {
    paint();
    if (!sigma) return;
    sigma.setSetting("labelColor", { color: view.current.palette.text });
    sigma.refresh();
  }, [paint, sigma, themeVersion]);

  const stopLayout = useCallback(() => {
    layoutRun.current++;
    if (layoutTimer.current) clearTimeout(layoutTimer.current);
    layoutTimer.current = null;
    layout.current?.stop();
    layout.current?.kill();
    layout.current = null;
    setArranging(false);
  }, []);

  const startLayout = useCallback(async () => {
    if (!sigma || graph.order === 0) return;
    stopLayout();
    const run = layoutRun.current;
    const [{ default: FA2Layout }, { default: forceAtlas2 }] = await Promise.all([
      import("graphology-layout-forceatlas2/worker"),
      import("graphology-layout-forceatlas2"),
    ]);
    if (run !== layoutRun.current) return;
    const plain = graph as unknown as Graph;
    const worker = new FA2Layout(plain, { settings: { ...forceAtlas2.inferSettings(plain), ...layoutSettings(graph.order) } });
    layout.current = worker;
    worker.start();
    setArranging(true);
    layoutTimer.current = setTimeout(() => {
      stopLayout();
      sigma.getCamera().animatedReset({ duration: 300 });
    }, layoutMillis(graph.order));
  }, [sigma, graph, stopLayout]);

  // Create the renderer. Sigma needs WebGL, so it is imported only in the browser.
  useEffect(() => {
    if (!container) return;
    let cancelled = false;
    let instance: Sigma | null = null;
    void (async () => {
      const [{ default: SigmaRenderer }, { EdgeArrowProgram, EdgeLineProgram }] = await Promise.all([import("sigma"), import("sigma/rendering")]);
      if (cancelled) return;
      paint();
      const dense = graph.order > 1200;
      const dimmed = (id: string) => {
        const v = view.current;
        return (v.faded?.has(id) ?? false) || (v.matches !== null && !v.matches.has(id));
      };
      instance = new SigmaRenderer(graph, container, {
        renderLabels: true,
        labelFont: "ui-monospace, monospace",
        labelSize: 11,
        labelColor: { color: view.current.palette.text },
        labelDensity: dense ? 0.07 : 0.15,
        labelGridCellSize: 80,
        labelRenderedSizeThreshold: dense ? 8 : 6,
        defaultEdgeType: "line",
        // Replaces Sigma's defaults, so both edge types the model emits are named here.
        edgeProgramClasses: { arrow: EdgeArrowProgram, line: EdgeLineProgram },
        minCameraRatio: 0.002,
        maxCameraRatio: 50,
        hideEdgesOnMove: true,
        hideLabelsOnMove: true,
        zIndex: true,
        nodeReducer: (id, data) => {
          const v = view.current;
          if (dimmed(id)) return { ...data, color: v.palette.fade, label: "", zIndex: 0 };
          const focus = v.hovered ?? v.selected;
          if (focus === null) return v.matches?.has(id) ? { ...data, forceLabel: true, zIndex: 1 } : data;
          if (id === focus) return { ...data, highlighted: true, forceLabel: true, zIndex: 2 };
          if (v.neighbours.has(id)) return { ...data, forceLabel: true, zIndex: 1 };
          return { ...data, color: v.palette.fade, label: "", zIndex: 0 };
        },
        edgeReducer: (edge, data) => {
          const v = view.current;
          const [source, target] = graph.extremities(edge);
          if (dimmed(source) || dimmed(target)) return { ...data, hidden: true };
          const focus = v.hovered ?? v.selected;
          if (focus === null) return data;
          if (source === focus || target === focus) return { ...data, color: v.palette.accent, size: 1.4, zIndex: 1 };
          return { ...data, hidden: true };
        },
      });
      instance.on("clickNode", ({ node }) => onSelectRef.current(node));
      instance.on("clickStage", () => onSelectRef.current(null));
      instance.on("enterNode", ({ node }) => {
        view.current.hovered = node;
        syncFocus();
        container.style.cursor = "pointer";
        instance?.refresh({ skipIndexation: true });
      });
      instance.on("leaveNode", () => {
        view.current.hovered = null;
        syncFocus();
        container.style.cursor = "grab";
        instance?.refresh({ skipIndexation: true });
      });
      container.style.cursor = "grab";
      setSigma(instance);
    })();
    return () => {
      cancelled = true;
      stopLayout();
      instance?.kill();
      setSigma(null);
    };
  }, [container, graph, paint, syncFocus, stopLayout]);

  useEffect(() => {
    void startLayout();
    return stopLayout;
  }, [startLayout, stopLayout]);

  useImperativeHandle(
    ref,
    () => ({
      focusNode: (id) => {
        const target = sigma?.getNodeDisplayData(id);
        if (sigma && target) sigma.getCamera().animate({ x: target.x, y: target.y, ratio: 0.15 }, { duration: 400 });
      },
    }),
    [sigma],
  );

  const button =
    "flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-wash-hover)] hover:text-[var(--color-text-primary)]";
  const controls = useMemo(
    () => [
      { label: "Zoom in", icon: ZoomIn, run: () => sigma?.getCamera().animatedZoom({ duration: 200 }) },
      { label: "Zoom out", icon: ZoomOut, run: () => sigma?.getCamera().animatedUnzoom({ duration: 200 }) },
      { label: "Fit view", icon: Maximize, run: () => sigma?.getCamera().animatedReset({ duration: 300 }) },
    ],
    [sigma],
  );

  return (
    <div className="relative h-full w-full" style={{ touchAction: "none" }} aria-label="Dependency graph">
      <div ref={setContainer} className="h-full w-full" style={{ background: "var(--color-bg-root)" }} />
      <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-1.5">
        {arranging && (
          <div className="animate-pulse rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)]/85 px-2 py-1 text-[10px] text-[var(--color-accent-primary)] shadow-sm backdrop-blur-sm">
            Arranging…
          </div>
        )}
        <div className="flex flex-col rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)]/85 p-1 shadow-sm backdrop-blur-sm">
          {controls.map(({ label, icon: Icon, run }) => (
            <button key={label} type="button" onClick={run} className={button} title={label} aria-label={label}>
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
          <button
            type="button"
            onClick={arranging ? stopLayout : () => void startLayout()}
            className={`${button} mt-1 border-t border-[var(--color-border-default)] pt-1`}
            title={arranging ? "Stop arranging" : "Re-arrange nodes"}
            aria-label={arranging ? "Stop arranging" : "Re-arrange nodes"}
            aria-pressed={arranging}
          >
            {arranging ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
});
