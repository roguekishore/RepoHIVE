"use client";

/**
 * Renders a repository's pages only once its
 * snapshot is resolved. Otherwise it says what is wrong: still loading, never
 * indexed, or an expired `?snapshot=`. The request form for a never-indexed
 * repository belongs to a later phase; this phase states the
 * fact and links home.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { useSnapshot } from "@/lib/snapshot/snapshot-context";

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="status" className="mx-auto flex max-w-xl flex-col gap-2 px-6 py-16 text-center">
      <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">{title}</h1>
      <div className="text-sm text-[var(--color-text-secondary)]">{children}</div>
    </div>
  );
}

export function SnapshotGate({ children }: { children: ReactNode }) {
  const { repoId, state } = useSnapshot();

  switch (state.status) {
    case "loading":
      return (
        <div role="status" className="px-6 py-16 text-center text-sm text-[var(--color-text-secondary)]">
          Loading the snapshot…
        </div>
      );
    case "never-indexed":
      return (
        <Notice title="This repository has not been indexed">
          <p>
            <span className="font-mono">{repoId}</span> has no published snapshot yet.
          </p>
          <p className="mt-2">
            <Link href="/" className="text-[var(--color-accent-primary)] hover:underline">
              Back to the repository list
            </Link>
          </p>
        </Notice>
      );
    case "expired":
      return (
        <Notice title="This snapshot has expired">
          <p>
            Snapshot <span className="font-mono">{state.requested}</span> is no longer published.
          </p>
          <p className="mt-2">
            {/* A plain anchor: the layout must remount to start a new session. */}
            <a href={`/repos/${repoId}`} className="text-[var(--color-accent-primary)] hover:underline">
              Open the latest snapshot
            </a>
          </p>
        </Notice>
      );
    case "error":
      return (
        <Notice title="The snapshot could not be loaded">
          <p>{state.message}</p>
        </Notice>
      );
    case "ready":
      return <>{children}</>;
  }
}
