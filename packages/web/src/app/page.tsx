import type { Metadata } from "next";
import { BrandLogo } from "@/components/layout/brand-logo";
import { OpenRepoForm } from "@/components/home/open-repo-form";

export const metadata: Metadata = { title: "RepoHIVE" };

/**
 * Landing. The list of indexed repositories (hosting-3 Requirement 11) is a
 * later phase; until then the page explains the product and opens a repository
 * by name. Nothing here reads an index: every repository page loads its
 * published snapshot.
 */
export default function LandingPage() {
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
      <OpenRepoForm />
    </div>
  );
}
