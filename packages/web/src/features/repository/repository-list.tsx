import Link from "next/link";
import type { ListedRepository } from "@/server/repositories/list-indexed-repositories";
import { repoIdToKnowledgeGraphPath, shortCommitSha } from "./repo-display";

function formatIndexedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
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
      <p className="mt-6 text-sm text-[var(--color-text-secondary)]">
        No indexed repositories yet. Seed local fixtures or request an index after signing in.
      </p>
    );
  }

  return (
    <section className="mt-8" aria-labelledby="indexed-repos-heading">
      <h2 id="indexed-repos-heading" className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
        Indexed repositories
      </h2>
      <ul className="mt-3 divide-y divide-[var(--color-border-subtle)] rounded-md border border-[var(--color-border-subtle)]">
        {items.map((entry) => (
          <li key={entry.repoKey} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Link
                href={repoIdToKnowledgeGraphPath(entry.repoId)}
                className="font-medium text-[var(--color-accent-primary)] hover:underline"
              >
                {entry.repoId}
              </Link>
              <p className="text-xs text-[var(--color-text-tertiary)]">
                {shortCommitSha(entry.commitSha)} · {entry.nodeCount.toLocaleString()} nodes ·{" "}
                {formatIndexedAt(entry.indexedAt)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {totalPages > 1 ? (
        <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Repository list pages">
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
