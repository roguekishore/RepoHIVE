"use client";

/**
 * Adaptivity — cross-repository, and deliberately not repo-scoped.
 *
 * This shell owns fetching only; the comparison itself is
 * `AdaptivityComparison` in `@repohive/ui/repohive`, which takes props and is
 * unit-tested there. Nothing is computed here: every figure comes from
 * `/api/adaptivity`, which reads each fixture's recorded `metadata.json`.
 */

import useSWR from "swr";
import { GitCompare } from "lucide-react";
import { PageShell } from "@repohive/ui/shared/page-shell";
import { AdaptivityComparison, type AdaptivityRepoView } from "@repohive/ui/repohive";

interface AdaptivityResponse {
  repos: AdaptivityRepoView[];
  sameConfiguration: boolean;
  configurationNote: string | null;
  skipped: string[];
}

async function fetchJson(url: string): Promise<AdaptivityResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed (${res.status}).`);
  }
  return res.json() as Promise<AdaptivityResponse>;
}

export function AdaptivityView() {
  const { data, error, isLoading } = useSWR<AdaptivityResponse>("/api/adaptivity", fetchJson, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

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
