"use client";

/**
 * Knowledge Graph: `/repos/[id]/knowledge-graph`.
 *
 * A continuous-zoom canvas of the system: start at the whole repo and zoom
 * *into* a card to reveal its layers, groups, folders and files, ranked by how
 * the system actually runs. The page wraps the shared `<ZoomCanvas>` with the
 * navigation chrome (breadcrumb, search-to-zoom, detail panel, first-visit hint)
 * and keeps the focused node in the URL so a zoom state is shareable.
 *
 * The chrome sits *around* the canvas, not on it. It used to be four floating
 * panels — breadcrumb, search, detail panel, hint — over the one thing on the
 * page that cannot be read past, and two of them shared the top-right corner,
 * so selecting a node dropped the detail panel on top of the search box.
 * Breadcrumb and search are now a header row, the detail panel is a rail, and
 * the canvas keeps the hover card (which tracks the pointer) plus the one-time
 * gesture hint, which teaches the canvas itself and never returns once
 * dismissed. Anything permanent goes around the map, not on it.
 *
 * This replaced the earlier node-link / layered-C4 Knowledge Graph. The reusable
 * C4 machinery it used to render still lives on (backend `c4_builder`, the zoom
 * map's own `/zoom-map` endpoint, and `@repohive/ui/c4` for the VS Code
 * webview); only the old web surface for it was retired.
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { ScanSearch } from "lucide-react";
import { PageShell } from "@repohive/ui/shared/page-shell";
import { ZoomCanvas } from "@repohive/ui/zoom";
import { CO_CHANGES, indexRelationsByNode } from "@repohive/ui/zoom";
import type { ZoomCanvasHandle, ZoomNode, ZoomRelation } from "@repohive/ui/zoom";
import { useZoomMap } from "@/lib/hooks/use-graph";
import { ZoomBreadcrumb } from "@/components/zoom/zoom-breadcrumb";
import { ZoomSearch } from "@/components/zoom/zoom-search";
import { ZoomDetailPanel } from "@/components/zoom/zoom-detail-panel";
import { ZoomMapKey } from "@/components/zoom/zoom-map-key";
import { ZoomHint } from "@/components/zoom/zoom-hint";
import { ZoomExportButton } from "@/components/zoom/zoom-export-button";

/** Stable identities, so an unselected / unloaded render does not churn props. */
const EMPTY_RELATIONS: ZoomRelation[] = [];
const NO_RELATIONS: Map<string, ZoomRelation[]> = new Map();

/**
 * The reason behind a failed zoom-map load (spec R12.2). The zoom-map route
 * returns `{ detail }` carrying the index parser's own message and the file
 * involved; ApiClientError exposes it as `detail` (and folds it into `message`).
 */
function zoomMapErrorReason(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { detail?: unknown; message?: unknown };
    if (typeof e.detail === "string" && e.detail.length > 0) return e.detail;
    if (typeof e.message === "string" && e.message.length > 0) return e.message;
  }
  return "The index could not be read.";
}

export default function KnowledgeGraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: repoId } = use(params);

  const { zoomMap, error, isLoading } = useZoomMap(repoId);
  const canvasRef = useRef<ZoomCanvasHandle | null>(null);

  const [focusParam, setFocusParam] = useQueryState(
    "focus",
    parseAsString.withOptions({ history: "replace", shallow: true }),
  );
  const [chain, setChain] = useState<ZoomNode[]>([]);
  const [selected, setSelected] = useState<ZoomNode | null>(null);
  const [relationVerb, setRelationVerb] = useState<string | null>(null);
  // E6: the blast-radius highlight set for the current selection.
  const [highlightIds, setHighlightIds] = useState<Set<string> | null>(null);

  // Snapshot the initial URL focus once so later URL writes don't re-trigger a jump.
  const initialFocus = useRef(focusParam ?? undefined).current;

  const flyTo = useCallback((id: string) => {
    canvasRef.current?.flyTo(id);
  }, []);

  const onFocusChange = useCallback(
    (next: ZoomNode[]) => {
      setChain(next);
      const deepest = next[next.length - 1];
      // Keep the URL in step with where the camera has settled (root = no param).
      void setFocusParam(deepest && deepest.parent_id ? deepest.id : null);
    },
    [setFocusParam],
  );

  const allNodes = useMemo(() => zoomMap?.nodes ?? [], [zoomMap]);
  const nodeById = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);
  // Indexed once per map rather than per selection: this repo ships 3,694
  // relations and both the rail and the hover card read them.
  const relationsByNode = useMemo(
    () => (zoomMap ? indexRelationsByNode(zoomMap) : NO_RELATIONS),
    [zoomMap],
  );
  const coChangeCount = useMemo(
    () => (zoomMap?.relations ?? []).filter((r) => r.label === CO_CHANGES).length,
    [zoomMap],
  );
  const showStats = process.env.NODE_ENV === "development";

  // E6: on select, fetch the node's blast radius (everything that depends on it)
  // and light it up across the map; clear it on deselect. The route rolls the
  // impacted leaves up to their ancestor cards, so the highlight reads at any
  // zoom level. Aborts in-flight requests when the selection changes.
  useEffect(() => {
    if (!selected) {
      setHighlightIds(null);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(
          `/api/graph/${repoId}/blast-radius?node=${encodeURIComponent(selected.id)}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          setHighlightIds(null);
          return;
        }
        const data = (await res.json()) as { ids?: string[] };
        setHighlightIds(new Set(data.ids ?? []));
      } catch {
        // Aborted (selection changed) or network error — leave un-highlighted.
      }
    })();
    return () => controller.abort();
  }, [selected, repoId]);

  return (
    <PageShell
      title="Knowledge Graph"
      icon={<ScanSearch className="h-5 w-5 text-[var(--color-accent-primary)]" />}
      description="Explore your codebase like a map: scroll to zoom, drag to pan, and double-click any card to dive into its layers, folders and files, ranked by how the code actually runs."
      // The export has its own endpoint and does not need the zoom map, but a
      // map that failed to load is the cheapest signal that this repo has
      // nothing indexed to export either.
      actions={<ZoomExportButton repoId={repoId} disabled={isLoading || !!error} />}
      maxWidth="wide"
    >
      {isLoading && (
        <div className="flex h-[520px] items-center justify-center text-sm text-[var(--color-text-secondary)]">
          Building the knowledge graph…
        </div>
      )}
      {error && !isLoading && (
        <div className="flex h-[520px] flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-sm font-medium text-[var(--color-error)]">
            Could not load the knowledge graph for this repository.
          </p>
          {/* The parser's reported reason and the file involved (R12.2). */}
          <p className="max-w-md text-xs text-[var(--color-text-secondary)]">
            {zoomMapErrorReason(error)}
          </p>
          {/* How to produce an index when none is present (R12.1). */}
          <p className="max-w-md text-xs text-[var(--color-text-tertiary)]">
            Run the group stage over this repository to produce its index, then reload.
          </p>
        </div>
      )}
      {zoomMap && !isLoading && (
        <>
          {/* A repository that produced no groups still renders its root node,
              with a plain statement of what happened (spec R12.4). */}
          {zoomMap.nodes.length <= 1 && (
            <div className="mb-3 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
              This repository produced no groups — only the repository node is shown.
            </div>
          )}
          {/* The one chrome row: where you are, and how to get somewhere. */}
          <div className="mb-3 flex items-start justify-between gap-3 border-b border-[var(--color-border-default)] pb-3">
            <ZoomBreadcrumb chain={chain} onCrumb={flyTo} />
            <ZoomSearch
              nodes={allNodes}
              onPick={(id) => {
                flyTo(id);
                setSelected(nodeById.get(id) ?? null);
              }}
            />
          </div>

          {/* Canvas and rail are peers in a grid, so the panel can never land
              on the map. Below xl the rail relocates under the canvas rather
              than covering it or disappearing. */}
          {/* Sized so the canvas and the key row below it both fit one screen.
              The key row explains the arrows, and the canvas swallows the wheel
              to zoom, so a reader whose pointer is over the map cannot scroll
              down to find it. */}
          <div
            className={`grid h-[calc(100vh-21.5rem)] min-h-[400px] gap-4 ${
              selected ? "xl:grid-cols-[minmax(0,1fr)_320px]" : "grid-cols-1"
            }`}
          >
            <div className="relative min-h-0 overflow-hidden rounded-lg">
              <ZoomCanvas
                ref={canvasRef}
                data={zoomMap}
                initialFocusId={initialFocus}
                onSelect={setSelected}
                onFocusChange={onFocusChange}
                showStats={showStats}
                relationVerb={relationVerb}
                relationsByNode={relationsByNode}
                highlightIds={highlightIds}
              />
              <ZoomHint />
            </div>
            {selected && (
              <div className="min-h-0 self-start xl:max-h-full">
                <ZoomDetailPanel
                  node={selected}
                  repoId={repoId}
                  relations={relationsByNode.get(selected.id) ?? EMPTY_RELATIONS}
                  relationVerb={relationVerb}
                  onClose={() => setSelected(null)}
                  onZoom={(id) => flyTo(id)}
                />
              </div>
            )}
          </div>

          <ZoomMapKey
            verb={relationVerb}
            onVerbChange={setRelationVerb}
            coChangeCount={coChangeCount}
          />

          {/* Decision legend (spec R7.4): what a group card's Preserved /
              Reconstructed note means, plus the honest caveat on reconstruct
              sub-clusters (§7-a). The distinction is carried as text, so it
              stays perceivable without colour (R7.6). */}
          <p className="mt-3 border-t border-[var(--color-border-default)] pt-3 text-[12px] leading-relaxed text-[var(--color-text-tertiary)]">
            Group cards say whether the algorithm{" "}
            <span className="text-[var(--color-text-secondary)]">Preserved</span> a region — its package
            kept as authored — or <span className="text-[var(--color-text-secondary)]">Reconstructed</span>{" "}
            it — rebuilt by dependency clustering — with the structural-quality score behind that call.
            Select a group to read it. Reconstruct sub-clusters share their region&rsquo;s decision
            (approximate). Selecting a file or group also lights up everything that depends on it
            (its blast radius) in red across the map.
          </p>
        </>
      )}
    </PageShell>
  );
}
