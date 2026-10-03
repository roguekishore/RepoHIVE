import Link from "next/link";
import { ArrowUpRight, BookMarked } from "lucide-react";
import { SectionLabel } from "@/components/shared/section-label";
import type { ListedRepository } from "@/server/repositories/list-indexed-repositories";
import { repoIdToKnowledgeGraphPath, shortCommitSha } from "./repo-display";

function formatIndexedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** A GitHub-style repository card: `owner/repo` title, then a row of facts. */
function RepositoryCard({ entry }: { entry: ListedRepository }) {
  const slash = entry.repoId.indexOf("/");
  const owner = slash === -1 ? "" : entry.repoId.slice(0, slash);
  const name = slash === -1 ? entry.repoId : entry.repoId.slice(slash + 1);

  return (
    <li className="group relative flex flex-col gap-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 transition-colors focus-within:border-[var(--color-border-hover)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-elevated)]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <BookMarked className="h-4 w-4 shrink-0 text-[var(--color-text-tertiary)]" aria-hidden />
          <Link
            href={repoIdToKnowledgeGraphPath(entry.repoId)}
            className="truncate text-[15px] font-semibold text-[var(--color-accent-primary)] before:absolute before:inset-0 before:rounded-lg before:content-[''] hover:underline focus-visible:outline-none"
          >
            {owner !== "" ? <span className="font-normal text-[var(--color-text-secondary)]">{owner} / </span> : null}
            {name}
          </Link>
        </div>
        <ArrowUpRight
          className="h-4 w-4 shrink-0 text-[var(--color-text-tertiary)] transition-colors group-hover:text-[var(--color-text-primary)]"
          aria-hidden
        />
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-tertiary)]">
        <span className="inline-flex items-center gap-1.5 text-[var(--color-success)]">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          Indexed
        </span>
        <span className="font-mono">{shortCommitSha(entry.commitSha)}</span>
        {entry.nodeCount > 0 ? <span>{entry.nodeCount.toLocaleString()} nodes</span> : null}
        <span>{formatIndexedAt(entry.indexedAt)}</span>
      </p>
    </li>
  );
}

export function RepositoryList({
  items,
  page,
  totalPages,
}: {
  items: readonly ListedRepository[];
  page: number;
  totalPages: number;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        No indexed repositories yet. Seed local fixtures or request an index after signing in.
      </p>
    );
  }

  return (
    <section aria-labelledby="indexed-repos-heading">
      <SectionLabel id="indexed-repos-heading">Indexed repositories</SectionLabel>
      <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((entry) => (
          <RepositoryCard key={entry.repoKey} entry={entry} />
        ))}
      </ul>
      {totalPages > 1 ? (
        <nav className="mt-6 flex items-center gap-3 text-sm" aria-label="Repository list pages">
          {page > 1 ? (
            <Link href={page === 2 ? "/" : `/?page=${page - 1}`} className="underline">
              Previous
            </Link>
          ) : null}
          <span>
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={`/?page=${page + 1}`} className="underline">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
