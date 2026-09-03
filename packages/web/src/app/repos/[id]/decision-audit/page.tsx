"use client";

/**
 * Decisions — `/repos/[id]/decision-audit` (spec R11; viewer handoff §9).
 *
 * The flagship surface for the project's actual contribution: the recorded
 * per-region preserve-vs-reconstruct decision. Top to bottom:
 *
 *  1. Boundary strip — every region on the score axis, the recorded quality
 *     boundary as a draggable line. Flips are pure client arithmetic over
 *     recorded scores (handoff §9 idea 2); the honest limit is stated in situ.
 *  2. Decision scatter — regions in the engine's own decision space, where
 *     the boundary is exactly a straight line.
 *  3. Provenance — the worked calculation for the selected region, plus the
 *     boundary morph: the same file set arranged by the authored package and
 *     by the derived groups.
 *  4. The audit table — every recorded value, rendered exactly.
 *
 * Selection and the counterfactual boundary live in the URL (nuqs), so a
 * pointed-at state is shareable and reproducible.
 */

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { parseAsFloat, parseAsString, useQueryState } from "nuqs";
import { ClipboardList } from "lucide-react";
import { PageShell } from "@repohive/ui/shared/page-shell";
import { ResponsiveTable, type ResponsiveColumn } from "@repohive/ui/shared/responsive-table";
import {
  BoundaryStrip,
  DecisionScatter,
  ProvenanceCard,
  RegionMorph,
  deriveRegionViews,
  type RegionPoint,
  type RegionView,
} from "@repohive/ui/repohive";
import {
  useRegionDecisions,
  useRegionDetail,
  type RegionDecisionsResponse,
} from "@/lib/hooks/use-decisions";

/** A number exactly as recorded — no rounding that would change a cited value. */
function Num({ value }: { value: number }) {
  return <span className="font-mono text-xs tabular-nums">{String(value)}</span>;
}

function ActionPill({ action }: { action: "preserve" | "reconstruct" }) {
  return action === "preserve" ? (
    <span className="text-[13px] font-medium text-[var(--color-success)]">● Preserved</span>
  ) : (
    <span className="text-[13px] font-medium text-[var(--color-warning)]">◇ Reconstructed</span>
  );
}

function toPoints(audit: RegionDecisionsResponse): RegionPoint[] {
  return audit.regions.map((r) => ({
    regionId: r.regionId,
    label: r.displayName ?? r.regionId,
    cohesion: r.cohesion,
    coupling: r.coupling,
    score: r.score,
    decisionConfidence: r.decisionConfidence,
    action: r.action,
    automaticAction: r.automaticAction,
    userOverridden: r.userOverridden,
    fileCount: r.fileCount,
    groupIds: r.groupIds,
  }));
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export default function DecisionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: repoId } = use(params);
  const { audit, error, isLoading } = useRegionDecisions(repoId);

  const [boundaryParam, setBoundaryParam] = useQueryState(
    "boundary",
    parseAsFloat.withOptions({ history: "replace", shallow: true }),
  );
  const [regionParam, setRegionParam] = useQueryState(
    "region",
    parseAsString.withOptions({ history: "replace", shallow: true }),
  );
  const [sortField, setSortField] = useState<string>("regionId");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const recordedBoundary = audit?.boundary ?? 0.5;
  const boundary = boundaryParam === null ? recordedBoundary : clamp01(boundaryParam);

  const views = useMemo(
    () =>
      audit
        ? deriveRegionViews(toPoints(audit), audit.cohesionSquashConstant, boundary)
        : [],
    [audit, boundary],
  );
  const selected = useMemo(
    () => views.find((v) => v.regionId === regionParam) ?? null,
    [views, regionParam],
  );

  const { detail, error: detailError, isLoading: detailLoading } = useRegionDetail(
    repoId,
    selected?.regionId ?? null,
  );

  const sortedViews = useMemo(() => {
    const dir = sortOrder === "asc" ? 1 : -1;
    const byRegion = (a: RegionView, b: RegionView) =>
      a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0;
    const numeric = (get: (v: RegionView) => number) => (a: RegionView, b: RegionView) =>
      dir * (get(a) - get(b)) || byRegion(a, b);
    switch (sortField) {
      case "score":
        return [...views].sort(numeric((v) => v.score));
      case "cohesion":
        return [...views].sort(numeric((v) => v.cohesion));
      case "coupling":
        return [...views].sort(numeric((v) => v.coupling));
      case "confidence":
        return [...views].sort(numeric((v) => v.decisionConfidence));
      case "files":
        return [...views].sort(numeric((v) => v.fileCount));
      case "action":
        return [...views].sort(
          (a, b) => dir * a.action.localeCompare(b.action) || byRegion(a, b),
        );
      default:
        return [...views].sort((a, b) => dir * byRegion(a, b));
    }
  }, [views, sortField, sortOrder]);

  const onSort = (key: string) => {
    if (key === sortField) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSortField(key);
      setSortOrder("asc");
    }
  };

  const columns: ResponsiveColumn<RegionView>[] = [
    {
      key: "regionId",
      header: "Region",
      priority: 1,
      sortable: true,
      render: (v) => (
        <span className="break-all font-mono text-xs text-[var(--color-text-primary)]">
          {v.label}
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      priority: 1,
      sortable: true,
      render: (v) => <ActionPill action={v.action} />,
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      priority: 1,
      sortable: true,
      render: (v) => <Num value={v.score} />,
    },
    {
      key: "cohesion",
      header: "Cohesion",
      align: "right",
      priority: 2,
      sortable: true,
      render: (v) => <Num value={v.cohesion} />,
    },
    {
      key: "coupling",
      header: "Coupling",
      align: "right",
      priority: 2,
      sortable: true,
      render: (v) => <Num value={v.coupling} />,
    },
    {
      key: "confidence",
      header: "Confidence",
      align: "right",
      priority: 3,
      sortable: true,
      render: (v) => <Num value={v.decisionConfidence} />,
    },
    {
      key: "files",
      header: "Files",
      align: "right",
      priority: 3,
      sortable: true,
      render: (v) => <Num value={v.fileCount} />,
    },
    {
      key: "basis",
      header: "Basis",
      priority: 3,
      render: (v) =>
        v.userOverridden ? (
          <span
            className="text-xs text-[var(--color-warning)]"
            title={`Automatic: ${v.automaticAction}`}
          >
            overridden
          </span>
        ) : (
          <span className="text-xs text-[var(--color-text-secondary)]">measured</span>
        ),
    },
    {
      key: "map",
      header: "Map",
      priority: 3,
      render: (v) =>
        v.groupIds.length > 0 ? (
          <Link
            href={`/repos/${repoId}/knowledge-graph?focus=${encodeURIComponent(v.groupIds[0]!)}`}
            className="text-xs text-[var(--color-accent-primary)] hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            View on map
          </Link>
        ) : (
          <span className="text-xs text-[var(--color-text-tertiary)]">—</span>
        ),
    },
  ];

  return (
    <PageShell
      title="Decisions"
      icon={<ClipboardList className="h-5 w-5 text-[var(--color-accent-primary)]" />}
      description="Regions large enough to assess were measured and their boundaries preserved or reconstructed; regions below the measurable threshold score 0 by rule and are reconstructed without assessment. Every value below is read from the recorded index — drag the boundary to test sensitivity, select a region to see the working."
    >
      {isLoading && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading the decision record…</p>
      )}
      {error && !isLoading && (
        <p className="text-sm text-[var(--color-error)]">
          {(error as Error).message ?? "Could not load the decision record."}
        </p>
      )}

      {audit && !isLoading && views.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          This index records no region decisions.
        </p>
      )}

      {audit && !isLoading && views.length > 0 && (
        <>
          {/* Effective configuration, so the run is reproducible from what is
              shown (R11.3). */}
          <dl className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
            <div className="flex gap-1.5">
              <dt className="text-[var(--color-text-tertiary)]">Quality boundary</dt>
              <dd className="tabular-nums text-[var(--color-text-primary)]">
                <Num value={audit.boundary} />
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-[var(--color-text-tertiary)]">Weights (cohesion / coupling)</dt>
              <dd className="tabular-nums text-[var(--color-text-primary)]">
                <Num value={audit.metricWeights.cohesion} /> /{" "}
                <Num value={audit.metricWeights.coupling} />
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-[var(--color-text-tertiary)]">Cohesion squash k</dt>
              <dd className="tabular-nums text-[var(--color-text-primary)]">
                <Num value={audit.cohesionSquashConstant} />
              </dd>
            </div>
            {audit.seed !== null && (
              <div className="flex gap-1.5">
                <dt className="text-[var(--color-text-tertiary)]">Seed</dt>
                <dd className="tabular-nums text-[var(--color-text-primary)]">
                  <Num value={audit.seed} />
                </dd>
              </div>
            )}
            <div className="flex gap-1.5">
              <dt className="text-[var(--color-text-tertiary)]">Regions</dt>
              <dd className="tabular-nums text-[var(--color-text-primary)]">{audit.regionCount}</dd>
            </div>
          </dl>

          {/* 1 — the boundary, draggable */}
          <section aria-label="Boundary sensitivity">
            <BoundaryStrip
              regions={views}
              boundary={boundary}
              recordedBoundary={recordedBoundary}
              onBoundaryChange={(b) => {
                void setBoundaryParam(Math.abs(b - recordedBoundary) < 1e-9 ? null : clamp01(b));
              }}
              selectedId={selected?.regionId ?? null}
              onSelect={(id) => void setRegionParam(id)}
            />
          </section>

          {/* 2 + 3 — decision space beside the selected region's working */}
          <section
            aria-label="Decision space and provenance"
            className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"
          >
            <DecisionScatter
              regions={views}
              weights={audit.metricWeights}
              boundary={boundary}
              recordedBoundary={recordedBoundary}
              selectedId={selected?.regionId ?? null}
              onSelect={(id) => void setRegionParam(id)}
            />
            {selected ? (
              <ProvenanceCard
                region={selected}
                weights={audit.metricWeights}
                squashK={audit.cohesionSquashConstant}
                recordedBoundary={recordedBoundary}
                counterfactualBoundary={boundaryParam === null ? null : boundary}
                seed={audit.seed}
                groups={(detail?.derived ?? []).map((cell) => ({
                  id: cell.id,
                  label: cell.label,
                  href: `/repos/${repoId}/knowledge-graph?focus=${encodeURIComponent(cell.id)}`,
                }))}
                LinkComponent={Link}
              />
            ) : (
              <div className="flex min-h-[200px] items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-default)] p-6 text-center text-sm text-[var(--color-text-tertiary)]">
                Select a region — in the strip, the scatter, or the table — to see the worked
                calculation behind its decision.
              </div>
            )}
          </section>

          {/* 4 — the signature moment: authored vs derived structure */}
          {selected && (
            <section aria-label="Authored versus derived structure">
              <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">
                Authored vs derived — {selected.label}
              </h2>
              <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
                The same {selected.fileCount} file{selected.fileCount === 1 ? "" : "s"}, arranged by
                the boundary the author wrote and by the groups the dependencies produced.
              </p>
              {detailLoading && (
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Loading the region&rsquo;s structure…
                </p>
              )}
              {detailError && !detailLoading ? (
                <p className="text-sm text-[var(--color-error)]">
                  {(detailError as Error).message ?? "Could not load the region detail."}
                </p>
              ) : null}
              {detail && !detailLoading && (
                <RegionMorph
                  regionLabel={detail.displayName}
                  action={detail.decision.action}
                  files={detail.files}
                  authored={detail.authored}
                  derived={detail.derived}
                  edges={detail.edges}
                  truncatedFiles={detail.truncatedFiles}
                />
              )}
            </section>
          )}

          {/* 5 — the audit record, exactly as recorded */}
          <section aria-label="Decision audit table">
            <ResponsiveTable<RegionView>
              columns={columns}
              rows={sortedViews}
              rowKey={(v) => v.regionId}
              onRowClick={(v) =>
                void setRegionParam(selected?.regionId === v.regionId ? null : v.regionId)
              }
              selectedKey={selected?.regionId ?? null}
              sortField={sortField}
              sortOrder={sortOrder}
              onSort={onSort}
              virtualize={{ maxHeight: 520 }}
              caption="Every recorded per-region decision: action, cohesion, coupling, score, confidence and basis."
              stacked="sm"
            />
          </section>
        </>
      )}
    </PageShell>
  );
}
