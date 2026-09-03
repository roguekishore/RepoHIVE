"use client";

/**
 * Architecture — `/repos/[id]/architecture`.
 *
 * The recorded artifacts that describe the hierarchy the engine built, rather
 * than the decisions behind it: how each level is populated, which groups
 * depend on which, how far the authored packages were split, and why re-running
 * produces the same result.
 *
 * This replaces the vendored architecture page, whose Symbols / Dependencies /
 * Coupling tabs fetched endpoints this app does not serve.
 */

import { use } from "react";
import useSWR from "swr";
import { Boxes } from "lucide-react";
import { parseAsInteger, useQueryState } from "nuqs";
import { PageShell } from "@repohive/ui/shared/page-shell";
import {
  DeterminismPanel,
  Fragmentation,
  GroupDsm,
  LevelFlow,
  type DeterminismPanelProps,
  type DsmEntryView,
  type DsmGroupView,
  type FragmentedRegionView,
  type LevelFlowRowData,
} from "@repohive/ui/repohive";

interface ArchitectureResponse {
  levels: LevelFlowRowData[];
  dsm: {
    groups: DsmGroupView[];
    entries: DsmEntryView[];
    blocks: Array<{ regionId: string; label: string; start: number; size: number }>;
    maxWeight: number;
    totalGroups: number;
    omittedGroups: number;
    shownEdges: number;
    totalEdges: number;
    level: number;
  };
  fragmentation: {
    regions: FragmentedRegionView[];
    totalReconstructed: number;
    omittedRegions: number;
    maxSplit: number;
  };
  determinism: Omit<DeterminismPanelProps, "configuration"> & {
    configuration: DeterminismPanelProps["configuration"];
  };
  availableLevels: Array<{ level: number; groupNodeCount: number }>;
}

async function fetchJson(url: string): Promise<ArchitectureResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed (${res.status}).`);
  }
  return res.json() as Promise<ArchitectureResponse>;
}

export default function ArchitecturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: repoId } = use(params);
  const [level, setLevel] = useQueryState(
    "level",
    parseAsInteger.withOptions({ history: "replace", shallow: true }),
  );
  const { data, error, isLoading } = useSWR<ArchitectureResponse>(
    `/api/graph/${repoId}/architecture${level === null ? "" : `?level=${level}`}`,
    fetchJson,
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  return (
    <PageShell
      title="Architecture"
      icon={<Boxes className="h-5 w-5 text-[var(--color-accent-primary)]" />}
      description="How the constructed hierarchy is populated, which groups depend on which, how far the authored packages were split, and why a re-run reproduces it exactly."
      maxWidth="wide"
    >
      {isLoading && <p className="text-sm text-[var(--color-text-secondary)]">Reading the index…</p>}
      {error && !isLoading && (
        <p className="text-sm text-[var(--color-error)]">
          {(error as Error).message ?? "Could not read the index."}
        </p>
      )}

      {data && !isLoading && (
        <>
          <section aria-label="Per-level flow">
            <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">
              How each level is populated
            </h2>
            <p className="mb-3 max-w-[74ch] text-xs text-[var(--color-text-secondary)]">
              The hierarchy narrows from the leaves up: every dependency edge lives at the leaf
              level, and each level above aggregates them into fewer, heavier cross-group edges.
            </p>
            <LevelFlow rows={data.levels} />
          </section>

          <section aria-label="Group dependency-structure matrix">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Which groups depend on which
              </h2>
              {data.availableLevels.length > 1 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[var(--color-text-tertiary)]">level</span>
                  {data.availableLevels.map((option) => (
                    <button
                      key={option.level}
                      type="button"
                      onClick={() => void setLevel(option.level === data.dsm.level ? null : option.level)}
                      aria-pressed={option.level === data.dsm.level}
                      title={`${option.groupNodeCount} groups at level ${option.level}`}
                      className={`rounded border px-2 py-0.5 font-mono text-[11px] tabular-nums transition-colors ${
                        option.level === data.dsm.level
                          ? "border-[var(--color-decision-boundary)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]"
                          : "border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
                      }`}
                    >
                      L{option.level}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <GroupDsm
              groups={data.dsm.groups}
              entries={data.dsm.entries}
              blocks={data.dsm.blocks}
              maxWeight={data.dsm.maxWeight}
              level={data.dsm.level}
              totalGroups={data.dsm.totalGroups}
              omittedGroups={data.dsm.omittedGroups}
              shownEdges={data.dsm.shownEdges}
              totalEdges={data.dsm.totalEdges}
            />
          </section>

          <section aria-label="Fragmentation">
            <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">
              How far the authored packages were split
            </h2>
            <p className="mb-3 max-w-[74ch] text-xs text-[var(--color-text-secondary)]">
              Where a package&rsquo;s boundary was rebuilt, this is how much the dependencies
              disagreed with it: one authored unit in, several dependency clusters out.
            </p>
            <Fragmentation
              regions={data.fragmentation.regions}
              totalReconstructed={data.fragmentation.totalReconstructed}
              omittedRegions={data.fragmentation.omittedRegions}
              maxSplit={data.fragmentation.maxSplit}
            />
          </section>

          <section aria-label="Determinism">
            <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">
              Why a re-run gives the same answer
            </h2>
            <p className="mb-3 max-w-[74ch] text-xs text-[var(--color-text-secondary)]">
              Determinism is the property that makes every other number on these surfaces citable.
              Here is the mechanism, not the assertion.
            </p>
            <DeterminismPanel
              scheme={data.determinism.scheme}
              repositoryId={data.determinism.repositoryId}
              samples={data.determinism.samples}
              totalGroups={data.determinism.totalGroups}
              distinctIds={data.determinism.distinctIds}
              seed={data.determinism.seed}
              configuration={data.determinism.configuration}
            />
          </section>
        </>
      )}
    </PageShell>
  );
}
