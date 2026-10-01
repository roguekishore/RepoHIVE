import type { Metadata } from "next";
import { BrandLogo } from "@/components/layout/brand-logo";
import { RepositoryList } from "@/components/home/repository-list";
import { getAppDatabase } from "@/lib/app-db/database";
import { getArtifactStore } from "@/lib/hosting/clients";
import { getAppConfig } from "@/lib/hosting/config";
import { listIndexedRepositories, paginateRepositories } from "@/lib/repositories/list-indexed-repositories";

export const metadata: Metadata = { title: "RepoHIVE" };

export const dynamic = "force-dynamic";

/**
 * Landing with the indexed repository list (hosting-3 Requirement 11).
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
    <div className="mx-auto max-w-[880px] p-5 sm:p-8">
      <header className="flex items-start gap-3 pt-2 sm:pt-6">
        <BrandLogo size={34} className="mt-1 shrink-0" />
        <div>
          <h1 className="font-serif text-2xl text-[var(--color-text-primary)] sm:text-3xl">RepoHIVE</h1>
          <p className="mt-1 max-w-[52ch] text-sm leading-relaxed text-[var(--color-text-secondary)]">
            A hierarchical index of each repository, built by measuring every package&rsquo;s structure and
            deciding, region by region, whether to{" "}
            <span className="text-[var(--color-success)]">preserve</span> its authored boundary or{" "}
            <span className="text-[var(--color-warning)]">reconstruct</span> it from the dependencies. Every
            decision is recorded.
          </p>
        </div>
      </header>
      <RepositoryList items={page.items} page={page.page} totalPages={page.totalPages} />
    </div>
  );
}
