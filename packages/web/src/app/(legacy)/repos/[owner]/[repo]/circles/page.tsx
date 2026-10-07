"use client";

/**
 * Circle graph (prototype): `/repos/[id]/circles`.
 *
 * The structure map's data drawn as a zoomable graph of nested circles: the
 * repository is one circle, its children are circles laid out inside it by how
 * they depend on each other, and each opens into its own graph as you zoom.
 * Edges stay hidden until a circle is selected; then its dependencies and
 * dependents appear, ending at whatever is visible at the current zoom. Runs of
 * single-child folders collapse into one step.
 *
 * A side-by-side prototype for comparison with the structure map; it reuses
 * that page's breadcrumb, search and detail panel.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { Orbit } from "lucide-react";
import type { BlastRadiusData } from "@repohive/views";
import { PageShell } from "@/components/shared/page-shell";
import { indexRelationsByNode } from "@/features/structure-map/canvas";
import type { ZoomMap, ZoomNode, ZoomRelation } from "@/features/structure-map/canvas";
import { useSnapshotJson } from "@/features/repository/snapshot-context";
import { ZoomBreadcrumb } from "@/features/structure-map/zoom-breadcrumb";
import { ZoomSearch } from "@/features/structure-map/zoom-search";
import { ZoomDetailPanel } from "@/features/structure-map/zoom-detail-panel";
import { CircleCanvas, type CircleCanvasHandle } from "@/features/circle-graph/CircleCanvas";
import { type CircleNode, buildCircleModel } from "@/features/circle-graph/model";

const NO_RELATIONS: Map<string, ZoomRelation[]> = new Map();
const EMPTY_RELATIONS: ZoomRelation[] = [];

export default function CircleGraphPage() {
  const { data: zoomMap, error, isLoading } = useSnapshotJson<ZoomMap>("views/zoom-map.json");
  // File-level edges, so a selection's links reach across groups. Until they
  // arrive, links fall back to the zoom map's sibling relations.
  const { data: blast } = useSnapshotJson<BlastRadiusData>(zoomMap ? "views/blast-radius.json" : null);
  const canvasRef = useRef<CircleCanvasHandle | null>(null);

  const model = useMemo(() => (zoomMap ? buildCircleModel(zoomMap, blast ?? null) : null), [zoomMap, blast]);
  const relationsByNode = useMemo(() => (zoomMap ? indexRelationsByNode(zoomMap) : NO_RELATIONS), [zoomMap]);

  const [focusPath, setFocusPath] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = (selectedId && model?.nodes.get(selectedId)) || null;
  const select = useCallback((node: CircleNode | null) => setSelectedId(node?.id ?? null), []);

  const flyTo = useCallback(
    (zoomId: string) => {
      const circleId = model?.circleOf.get(zoomId);
      if (circleId) canvasRef.current?.flyTo(circleId);
    },
    [model],
  );

  // The breadcrumb shows every merged level, so a collapsed run is still named in full.
  const chain = useMemo<ZoomNode[]>(
    () => (model ? focusPath.flatMap((id) => model.nodes.get(id)?.chain ?? []) : []),
    [model, focusPath],
  );

  return (
    <PageShell
      title="Circle graph (prototype)"
      icon={<Orbit className="h-5 w-5 text-[var(--color-accent-primary)]" />}
      description="The same structure as a graph of nested circles. Scroll to zoom, click a circle to see what it depends on and what depends on it, double-click to fly in, and double-click empty space to fly out."
      maxWidth="wide"
    >
      {isLoading && (
        <div className="flex h-[520px] items-center justify-center text-sm text-[var(--color-text-secondary)]">
          Loading the structure…
        </div>
      )}
      {error && !isLoading && (
        <div className="flex h-[520px] items-center justify-center text-sm text-[var(--color-error)]">
          Could not load the structure for this repository.
        </div>
      )}
      {zoomMap && model && !isLoading && (
        <>
          <div className="mb-3 flex items-start justify-between gap-3 border-b border-[var(--color-border-default)] pb-3">
            <ZoomBreadcrumb chain={chain} onCrumb={flyTo} />
            <ZoomSearch
              nodes={zoomMap.nodes}
              onPick={(id) => {
                flyTo(id);
                setSelectedId(model.circleOf.get(id) ?? null);
              }}
            />
          </div>
          <div
            className={`grid h-[calc(100vh-21.5rem)] min-h-[400px] gap-4 ${
              selected ? "xl:grid-cols-[minmax(0,1fr)_320px]" : "grid-cols-1"
            }`}
          >
            <div className="relative min-h-0 overflow-hidden rounded-lg">
              <CircleCanvas
                ref={canvasRef}
                model={model}
                selectedId={selected?.id ?? null}
                onSelect={select}
                onFocusChange={setFocusPath}
              />
            </div>
            {selected && (
              <div className="min-h-0 self-start xl:max-h-full">
                <ZoomDetailPanel
                  node={selected.node}
                  relations={relationsByNode.get(selected.chain[0]!.id) ?? EMPTY_RELATIONS}
                  relationVerb={null}
                  onClose={() => setSelectedId(null)}
                  onZoom={flyTo}
                />
              </div>
            )}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-text-tertiary)]">
            Circle size follows file count; outlines show the group decision (Preserved or Reconstructed) or file
            health. With a circle selected,{" "}
            <span className="text-[var(--color-accent-primary)]">accent lines</span> run to what it depends on and{" "}
            <span className="text-[var(--color-accent-secondary)]">secondary lines</span> come from what depends on it.
            {!model.leafLinks && " Loading cross-group links…"}
          </p>
        </>
      )}
    </PageShell>
  );
}
