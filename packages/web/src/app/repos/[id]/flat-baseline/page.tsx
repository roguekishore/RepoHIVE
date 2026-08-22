"use client";

/**
 * Flat baseline — `/repos/[id]/flat-baseline` (spec R10, Phase D).
 *
 * The same repository and the same `index/` as the Knowledge Graph, rendered as
 * ONE unstructured node-link diagram: every file and every leaf dependency
 * edge, no grouping. It is the deliberate "before" to the hierarchy's "after" —
 * the side-by-side that lets a reviewer judge whether the hierarchy is an
 * improvement. It is RepoHIVE's own dependency graph drawn flat, not a
 * deficiency of any other tool (R10.6).
 *
 * It reuses the vendored `files`-scope graph canvas, locked to that scope (the
 * community scope RepoHIVE does not feed is hidden). Data comes from
 * `GET /api/graph/{id}`.
 */

import { use } from "react";
import Link from "next/link";
import { Network } from "lucide-react";
import { GraphView } from "@/components/architecture/graph-view";
import { useGraph } from "@/lib/hooks/use-graph";

export default function FlatBaselinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: repoId } = use(params);
  // Shares the SWR key with the canvas's own fetch, so this reads the counts
  // without a second request.
  const { graph, isLoading } = useGraph(repoId);
  const nodeCount = graph?.nodes.length ?? 0;
  const edgeCount = graph?.links.length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-[var(--color-border-default)] px-4 pb-3 pt-3 sm:px-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--color-text-primary)]">
          <Network className="h-5 w-5 text-[var(--color-accent-primary)]" />
          Flat baseline
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          The whole repository as one unstructured dependency graph — RepoHIVE&rsquo;s own graph, drawn
          flat.{" "}
          {!isLoading && graph ? (
            <span className="tabular-nums text-[var(--color-text-primary)]">
              {nodeCount.toLocaleString()} files · {edgeCount.toLocaleString()} dependencies
              {graph.truncated ? " (truncated for rendering)" : ""}.
            </span>
          ) : (
            <span className="text-[var(--color-text-tertiary)]">Loading the graph…</span>
          )}{" "}
          <Link
            href={`/repos/${repoId}/knowledge-graph`}
            className="text-[var(--color-accent-primary)] hover:underline"
          >
            Open the hierarchical map
          </Link>{" "}
          to see the same repository organized.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Locked to the file scope; the community scope RepoHIVE does not feed
            is hidden (R9). onScopeChange is a no-op for the same reason. */}
        <GraphView repoId={repoId} scope="files" showScopeSwitcher={false} onScopeChange={() => {}} />
      </div>
    </div>
  );
}
