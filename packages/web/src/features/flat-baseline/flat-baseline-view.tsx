"use client";

/**
 * The flat baseline: the whole repository as one unstructured dependency
 * graph, every file and every leaf dependency, no grouping. It is the
 * deliberate "before" to the hierarchy's "after", drawn from the same index.
 * Data is the snapshot's `views/graph.json`.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Network } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSnapshot, useSnapshotJson } from "@/features/repository/snapshot-context";
import { FilePanel } from "./file-panel";
import { FlatGraphCanvas, type FlatGraphCanvasHandle } from "./flat-graph-canvas";
import { buildFlatGraph, matchingNodes, moduleCounts, nodesOutsideModule, type FlatGraphData } from "./graph-model";

export function FlatBaselineView() {
  const { repoId } = useSnapshot();
  const { data, error, isLoading } = useSnapshotJson<FlatGraphData>("views/graph.json");
  const graph = useMemo(() => (data ? buildFlatGraph(data) : null), [data]);
  const modules = useMemo(() => (graph ? moduleCounts(graph) : []), [graph]);

  const [query, setQuery] = useState("");
  const [module, setModule] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const canvas = useRef<FlatGraphCanvasHandle>(null);

  const matches = useMemo(() => (graph ? matchingNodes(graph, query) : null), [graph, query]);
  const faded = useMemo(() => (graph ? nodesOutsideModule(graph, module) : null), [graph, module]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const select = (id: string) => {
    setSelected(id);
    canvas.current?.focusNode(id);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-[var(--color-border-default)] px-4 pb-3 pt-3 sm:px-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--color-text-primary)]">
          <Network className="h-5 w-5 text-[var(--color-accent-primary)]" />
          Flat baseline
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          The whole repository as one unstructured dependency graph, drawn flat.{" "}
          {graph ? (
            <span className="tabular-nums text-[var(--color-text-primary)]">
              {graph.order.toLocaleString()} files · {graph.size.toLocaleString()} dependencies.
            </span>
          ) : (
            <span className="text-[var(--color-text-tertiary)]">{error ? "The graph could not be loaded." : "Loading the graph…"}</span>
          )}{" "}
          <Link href={`/repos/${repoId}/knowledge-graph`} className="text-[var(--color-accent-primary)] hover:underline">
            Open the hierarchical map
          </Link>{" "}
          to see the same repository organized.
        </p>
        {graph && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files"
              aria-label="Search files"
              className="h-8 w-56 text-xs"
            />
            {modules.length > 1 && (
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">Module</span>
                <select
                  value={module ?? ""}
                  onChange={(event) => setModule(event.target.value || null)}
                  className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-2 py-1 text-xs text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
                >
                  <option value="">All modules</option>
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id} · {m.fileCount.toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {matches !== null && (
              <span className="text-xs tabular-nums text-[var(--color-text-tertiary)]">
                {matches.size.toLocaleString()} of {graph.order.toLocaleString()} match
              </span>
            )}
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {isLoading && <div className="h-full w-full animate-pulse bg-[var(--color-bg-elevated)]" />}
        {graph && graph.order === 0 && (
          <p className="px-6 py-16 text-center text-sm text-[var(--color-text-secondary)]">This snapshot has no files to draw.</p>
        )}
        {graph && graph.order > 0 && (
          <>
            <FlatGraphCanvas ref={canvas} graph={graph} selected={selected} matches={matches} faded={faded} onSelect={setSelected} />
            {selected !== null && graph.hasNode(selected) && (
              <FilePanel graph={graph} id={selected} onSelect={select} onClose={() => setSelected(null)} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
