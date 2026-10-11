import type { Metadata } from "next";
import { BrandLogo } from "@/components/shared/brand-logo";
import { SectionLabel } from "@/components/shared/section-label";
import { RequestIndexForm } from "@/features/account/request-index-form";
import { RepositoryList } from "@/features/repository/repository-list";
import { getAppDatabase } from "@/server/app-db/database";
import { getArtifactStore } from "@/server/hosting/clients";
import { getAppConfig } from "@/server/hosting/config";
import { listIndexedRepositories, paginateRepositories } from "@/server/repositories/list-indexed-repositories";

// `absolute`: the page now sits below the root layout (inside `(legacy)`), so the title template would otherwise apply.
export const metadata: Metadata = { title: { absolute: "RepoHIVE" } };

export const dynamic = "force-dynamic";

/**
 * Dashboard: brand and description, the index
 * request, then the indexed repositories as a card grid.
 */
export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const pageNumber = Number.parseInt(params.page ?? "1", 10);
  const config = getAppConfig();
  const db = getAppDatabase();
  const store = getArtifactStore(config);
  const all = await listIndexedRepositories(db, config, store);
  const page = paginateRepositories(all, pageNumber);

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <header className="space-y-4">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
          <div className="flex shrink-0 items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-sm)]">
              <BrandLogo size={32} />
            </span>
            <h1 className="text-3xl tracking-tight text-[var(--color-text-primary)] sm:text-4xl">
              <span className="font-light text-[var(--color-text-secondary)]">Repo</span>
              <span className="font-semibold">HIVE</span>
            </h1>
          </div>
          <p className="max-w-[78ch] text-base leading-relaxed text-[var(--color-text-secondary)] [text-wrap:pretty] lg:pt-1.5">
            A hierarchical index of each repository, built by measuring every package&rsquo;s structure and
            deciding, region by region, whether to{" "}
            <span className="font-medium text-[var(--color-success)]">preserve</span> its authored boundary or{" "}
            <span className="font-medium text-[var(--color-warning)]">reconstruct</span> it from the dependencies.
            Every decision is recorded.
          </p>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--color-text-tertiary)]">
          <span>
            {page.total.toLocaleString()} {page.total === 1 ? "repository" : "repositories"} indexed
          </span>
          <span aria-hidden>&middot;</span>
          <span>Identical input, identical output</span>
          <span aria-hidden>&middot;</span>
          <span>Every decision recorded</span>
        </p>
      </header>

      <section
        aria-labelledby="request-index-heading"
        className="mt-8 space-y-3 border-t border-[var(--color-border-default)] pt-8"
      >
        <div className="space-y-1">
          <SectionLabel id="request-index-heading">Request an index</SectionLabel>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Paste <span className="font-mono text-[13px]">owner/repo</span> or a GitHub URL. Indexing needs an
            account.
          </p>
        </div>
        <RequestIndexForm layout="inline" />
      </section>

      <div className="mt-8 border-t border-[var(--color-border-default)] pt-8">
        <RepositoryList items={page.items} page={page.page} totalPages={page.totalPages} />
      </div>
    </div>
  );
}
