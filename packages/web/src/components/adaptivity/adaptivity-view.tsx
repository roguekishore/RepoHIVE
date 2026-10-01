"use client";

/**
 * Adaptivity: one snapshot's assessed preserve rate, per repository.
 *
 * This shell owns fetching only; the comparison itself is
 * `AdaptivityComparison` in `@repohive/ui/repohive`, which takes props and is
 * unit-tested there. Nothing is computed here: every figure comes from
 * the snapshot's `views/adaptivity.json`, built at index time from the recorded
 * `metadata.json` (one repository per snapshot).
 */

import { GitCompare } from "lucide-react";
import { PageShell } from "@repohive/ui/shared/page-shell";
import { AdaptivityComparison, type AdaptivityRepoView } from "@repohive/ui/repohive";
import { useSnapshotJson } from "@/lib/snapshot/snapshot-context";

interface AdaptivityResponse {
  repos: AdaptivityRepoView[];
  sameConfiguration: boolean;
  configurationNote: string | null;
  skipped: string[];
}

export function AdaptivityView() {
  const { data, error, isLoading } = useSnapshotJson<AdaptivityResponse>("views/adaptivity.json");

  return (
    <PageShell
      title="Adaptivity"
      icon={<GitCompare className="h-5 w-5 text-[var(--color-accent-primary)]" />}
      description="One algorithm, one configuration, different repositories. If the engine applied a single policy everywhere, these rates would match."
    >
      {isLoading && <p className="text-sm text-[var(--color-text-secondary)]">Reading each index…</p>}
      {error && !isLoading && (
        <p className="text-sm text-[var(--color-error)]">
          {(error as Error).message ?? "Could not read the indexes."}
        </p>
      )}
      {data && !isLoading && (
        <AdaptivityComparison
          repos={data.repos}
          sameConfiguration={data.sameConfiguration}
          configurationNote={data.configurationNote}
          skipped={data.skipped}
        />
      )}
    </PageShell>
  );
}
