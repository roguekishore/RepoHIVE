"use client";

import { useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useClient, type SnapshotState } from "@repohive/design";
import { loadSnapshotState } from "./snapshot-state";

export interface RepositoryContextValue {
  readonly owner: string;
  readonly name: string;
  /** `{ status: "loading" }` until the pointer (or the `?snapshot=` id) resolves, then fixed for the page's life. */
  readonly snapshot: SnapshotState;
}

const RepositoryContext = createContext<RepositoryContextValue | undefined>(undefined);

/**
 * Resolves the page's `SnapshotState` once and hands it to the repository's screens through `useRepository`. The
 * repository layout keys this by repository, so each repository gets its own session. It reads `?snapshot=` and nothing
 * else from the URL; the screen decides what to show for each status.
 */
export function RepositoryState({ owner, name, children }: { owner: string; name: string; children: ReactNode }) {
  const client = useClient();
  const requested = useSearchParams().get("snapshot");
  const [snapshot, setSnapshot] = useState<SnapshotState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void loadSnapshotState(client, owner, name, requested).then((next) => {
      if (!cancelled) setSnapshot(next);
    });
    return () => {
      cancelled = true;
    };
    // A page keeps its first answer; the layout is re-keyed on a repository change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({ owner, name, snapshot }), [owner, name, snapshot]);
  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}

/** The repository a page belongs to and its snapshot state. Throws outside the repository layout. */
export function useRepository(): RepositoryContextValue {
  const value = useContext(RepositoryContext);
  if (value === undefined) throw new Error("useRepository must be used inside the repository layout");
  return value;
}
