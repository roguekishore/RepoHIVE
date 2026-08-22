"use client";

/**
 * Decision audit — `/repos/[id]/decision-audit` (spec R11, Phase D).
 *
 * A read-only table of every per-Region preserve-vs-reconstruct decision, read
 * straight from `metadata.json`: cohesion, coupling, the structural-quality
 * score, the boundary applied, the chosen action, and confidence — plus whether
 * each was measured or overridden. This makes Claim B (adaptive grouping)
 * auditable rather than asserted: a reviewer can check the algorithm's
 * reasoning instead of trusting a picture. Values are shown as recorded (R11.6).
 */

import { use } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ClipboardList } from "lucide-react";

interface RegionRow {
  regionId: string;
  cohesion: number;
  coupling: number;
  modularity?: number;
  score: number;
  action: "preserve" | "reconstruct";
  automaticAction: "preserve" | "reconstruct";
  userOverridden: boolean;
  decisionConfidence: number;
  groupIds: string[];
}

interface AuditResponse {
  boundary: number;
  metricWeights: { cohesion: number; coupling: number; modularity?: number };
  cohesionSquashConstant: number;
  regionCount: number;
  regions: RegionRow[];
}

async function fetchAudit(url: string): Promise<AuditResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed (${res.status}).`);
  }
  return res.json() as Promise<AuditResponse>;
}

/** A number exactly as recorded — no rounding that would change a cited value. */
function Num({ value }: { value: number }) {
  return <span className="tabular-nums">{String(value)}</span>;
}

export default function DecisionAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: repoId } = use(params);
  const { data, error, isLoading } = useSWR<AuditResponse>(
    `/api/graph/${repoId}/region-decisions`,
    fetchAudit,
    { revalidateOnFocus: false },
  );

  return (
    <div className="mx-auto max-w-[1200px] p-4 sm:p-6">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--color-text-primary)]">
        <ClipboardList className="h-5 w-5 text-[var(--color-accent-primary)]" />
        Decision audit
      </h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Every per-region preserve-vs-reconstruct decision, read from the index. A region is preserved
        when its structural-quality score is at or above the boundary, and reconstructed below it.
      </p>

      {isLoading && (
        <p className="mt-6 text-sm text-[var(--color-text-secondary)]">Loading decisions…</p>
      )}
      {error && !isLoading && (
        <p className="mt-6 text-sm text-[var(--color-error)]">
          {(error as Error).message ?? "Could not load the decision record."}
        </p>
      )}

      {data && !isLoading && (
        <>
          {/* Effective configuration, so the run is reproducible from what is
              shown (R11.3). */}
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
            <div className="flex gap-1.5">
              <dt className="text-[var(--color-text-tertiary)]">Quality boundary</dt>
              <dd className="tabular-nums text-[var(--color-text-primary)]">
                <Num value={data.boundary} />
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-[var(--color-text-tertiary)]">Cohesion weight</dt>
              <dd className="tabular-nums text-[var(--color-text-primary)]">
                <Num value={data.metricWeights.cohesion} />
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-[var(--color-text-tertiary)]">Coupling weight</dt>
              <dd className="tabular-nums text-[var(--color-text-primary)]">
                <Num value={data.metricWeights.coupling} />
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-[var(--color-text-tertiary)]">Cohesion squash</dt>
              <dd className="tabular-nums text-[var(--color-text-primary)]">
                <Num value={data.cohesionSquashConstant} />
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-[var(--color-text-tertiary)]">Regions</dt>
              <dd className="tabular-nums text-[var(--color-text-primary)]">{data.regionCount}</dd>
            </div>
          </dl>

          <div className="mt-4 overflow-x-auto rounded-md border border-[var(--color-border-default)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-left text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  <th className="px-3 py-2 font-medium">Region</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 text-right font-medium">Cohesion</th>
                  <th className="px-3 py-2 text-right font-medium">Coupling</th>
                  <th className="px-3 py-2 text-right font-medium">Score</th>
                  <th className="px-3 py-2 text-right font-medium">Confidence</th>
                  <th className="px-3 py-2 font-medium">Basis</th>
                  <th className="px-3 py-2 font-medium">Map</th>
                </tr>
              </thead>
              <tbody>
                {data.regions.map((r) => (
                  <tr
                    key={r.regionId}
                    className="border-b border-[var(--color-border-default)] last:border-0"
                  >
                    <td className="px-3 py-1.5 font-mono text-xs text-[var(--color-text-primary)]">
                      {r.regionId}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={
                          r.action === "preserve"
                            ? "text-[var(--color-success)]"
                            : "text-[var(--color-warning)]"
                        }
                      >
                        {r.action === "preserve" ? "Preserved" : "Reconstructed"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Num value={r.cohesion} />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Num value={r.coupling} />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Num value={r.score} />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Num value={r.decisionConfidence} />
                    </td>
                    <td className="px-3 py-1.5 text-xs text-[var(--color-text-secondary)]">
                      {r.userOverridden ? (
                        <span title={`Automatic: ${r.automaticAction}`}>overridden</span>
                      ) : (
                        "measured"
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      {r.groupIds.length > 0 ? (
                        <Link
                          href={`/repos/${repoId}/knowledge-graph?focus=${encodeURIComponent(r.groupIds[0]!)}`}
                          className="text-[var(--color-accent-primary)] hover:underline"
                        >
                          View on map
                        </Link>
                      ) : (
                        <span className="text-[var(--color-text-tertiary)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
