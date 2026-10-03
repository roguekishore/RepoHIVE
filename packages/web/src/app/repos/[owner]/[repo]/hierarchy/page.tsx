"use client";

/**
 * Hierarchy — `/repos/[id]/hierarchy`.
 *
 * The whole containment tree in one image, coloured by the recorded decision
 * state. Its job is to show scale handled: depth as radius, file count as
 * sweep, so a 30,889-node repository reads as a structure rather than as a
 * number.
 */

import { Network } from "lucide-react";
import { PageShell } from "@/components/shared/page-shell";
import { parseAsString, useQueryState } from "nuqs";
import { DecisionLegend } from "@/features/decisions/decision-mark";
import { HierarchySunburst, type SunburstArc } from "@/features/hierarchy/hierarchy-sunburst";
import { useSnapshotJson } from "@/features/repository/snapshot-context";

interface HierarchyScaleResponse {
  arcs: SunburstArc[];
  maxLevel: number;
  totalFiles: number;
  totalNodes: number;
  omittedArcs: number;
  levels: Array<{
    level: number;
    groupNodeCount: number;
    leafNodeCount: number;
    crossGroupEdgeCount: number;
    leafEdgeCount: number;
  }>;
  counts: Record<"preserve" | "reconstruct" | "degenerate" | "none", number>;
}

export default function HierarchyPage() {
  const { data, error, isLoading } = useSnapshotJson<HierarchyScaleResponse>("views/hierarchy-scale.json");
  const [selected, setSelected] = useQueryState(
    "arc",
    parseAsString.withOptions({ history: "replace", shallow: true }),
  );

  return (
    <PageShell
      title="Hierarchy"
      icon={<Network className="h-5 w-5 text-[var(--color-accent-primary)]" />}
      description="Every level of the constructed hierarchy at once: radius is depth, sweep is the number of files beneath, colour is the decision recorded for that region."
      maxWidth="wide"
    >
      {isLoading && (
        <p className="text-sm text-[var(--color-text-secondary)]">Rolling up the tree…</p>
      )}
      {error && !isLoading && (
        <p className="text-sm text-[var(--color-error)]">
          {(error as Error).message ?? "Could not read the hierarchy."}
        </p>
      )}

      {data && !isLoading && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-[var(--color-text-secondary)]">
            <span>
              <strong className="font-semibold tabular-nums text-[var(--color-text-primary)]">
                {data.totalNodes.toLocaleString()}
              </strong>{" "}
              nodes
            </span>
            <span>
              <strong className="font-semibold tabular-nums text-[var(--color-text-primary)]">
                {data.totalFiles.toLocaleString()}
              </strong>{" "}
              files
            </span>
            <span>
              depth{" "}
              <strong className="font-semibold tabular-nums text-[var(--color-text-primary)]">
                {data.maxLevel}
              </strong>
            </span>
            <span>
              <strong className="font-semibold tabular-nums text-[var(--color-text-primary)]">
                {data.arcs.length.toLocaleString()}
              </strong>{" "}
              arcs drawn
            </span>
          </div>
          <DecisionLegend />
          </div>

          <HierarchySunburst
            arcs={data.arcs}
            maxLevel={data.maxLevel}
            totalFiles={data.totalFiles}
            totalNodes={data.totalNodes}
            omittedArcs={data.omittedArcs}
            levels={data.levels}
            selectedId={selected}
            onSelect={(id) => void setSelected(id)}
            size={680}
          />
        </>
      )}
    </PageShell>
  );
}
