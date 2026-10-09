"use client";

/**
 * Renders a repository's pages only once its
 * snapshot is resolved. Otherwise it says what is wrong: still loading, never
 * indexed, or an expired `?snapshot=`. A signed-in visitor sees the request
 * form prefilled for a never-indexed repository.
 */
import type { ReactNode } from "react";
import { NeverIndexedNotice } from "@/components/layout/never-indexed-notice";
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
      return <NeverIndexedNotice repoId={repoId} />;
    case "expired":
      return (
        <Notice title="This snapshot has expired">
          <div aria-live="polite">
            <p>
              Snapshot <span className="font-mono">{state.requested}</span> is no longer published.
            </p>
            <p className="mt-2">
              {/* A plain anchor: the layout must remount to start a new session. */}
              <a href={`/repos/${repoId}`} className="text-[var(--color-accent-primary)] hover:underline">
                Open the latest snapshot
              </a>
            </p>
          </div>
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
