"use client";

import { X } from "lucide-react";
import type { FlatGraph } from "./graph-model";

const LIST_LIMIT = 100;

function FileList({ title, ids, graph, onSelect }: { title: string; ids: string[]; graph: FlatGraph; onSelect: (id: string) => void }) {
  if (ids.length === 0) return null;
  const shown = ids.slice(0, LIST_LIMIT);
  return (
    <section className="mt-4">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
        {title} · {ids.length.toLocaleString()}
      </h3>
      <ul className="mt-1.5 space-y-0.5">
        {shown.map((id) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onSelect(id)}
              title={id}
              className="block w-full truncate rounded px-1.5 py-1 text-left font-mono text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-wash-hover)] hover:text-[var(--color-text-primary)]"
            >
              {graph.getNodeAttribute(id, "label")}
            </button>
          </li>
        ))}
      </ul>
      {ids.length > shown.length && (
        <p className="mt-1 px-1.5 text-xs text-[var(--color-text-tertiary)]">and {(ids.length - shown.length).toLocaleString()} more</p>
      )}
    </section>
  );
}

/** One selected file: where it lives, and what it imports and is imported by. */
export function FilePanel({ graph, id, onSelect, onClose }: { graph: FlatGraph; id: string; onSelect: (id: string) => void; onClose: () => void }) {
  const attrs = graph.getNodeAttributes(id);
  const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return (
    <aside
      aria-label="Selected file"
      className="absolute right-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-72 flex-col overflow-hidden rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)]/95 shadow-lg backdrop-blur-sm"
    >
      <div className="flex items-start gap-2 border-b border-[var(--color-border-default)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="break-all font-mono text-xs text-[var(--color-text-primary)]">{attrs.path}</p>
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
            {attrs.module} · {attrs.symbols.toLocaleString()} {attrs.symbols === 1 ? "symbol" : "symbols"}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="overflow-y-auto px-3 pb-3">
        <FileList title="Imports" ids={graph.outNeighbors(id).sort(byPath)} graph={graph} onSelect={onSelect} />
        <FileList title="Imported by" ids={graph.inNeighbors(id).sort(byPath)} graph={graph} onSelect={onSelect} />
      </div>
    </aside>
  );
}
