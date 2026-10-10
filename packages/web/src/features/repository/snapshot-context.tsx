"use client";

/**
 * One snapshot per page session.
 *
 * The provider resolves a repository's snapshot once, from `?snapshot=<id>` when
 * that is a valid id and otherwise from `GET /api/repos/<owner>/<repo>`, and
 * then never changes it. Every view fetch under it reads
 * `/artifacts/<owner>/<repo>/<id>/...`, so a re-index published
 * while the page is open cannot mix two snapshots. The layout keys the provider
 * by repository, so moving to another repository starts a new session.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { artifactPath, parseSnapshotParam, repoApiPath } from "./repo-name";

export type SnapshotState =
  | { status: "loading" }
  /** The server has no snapshot for it (404): the repository has never been indexed. */
  | { status: "never-indexed" }
  /** `?snapshot=` named a snapshot that is no longer published. */
  | { status: "expired"; requested: string }
  | { status: "error"; message: string }
  | { status: "ready"; snapshotId: string; source: "latest" | "query"; commitSha?: string };

const SnapshotContext = createContext<{ repoId: string; state: SnapshotState } | null>(null);

async function fetchOptionalJson(url: string): Promise<unknown | undefined> {
  const response = await fetch(url);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
  return response.json();
}

export async function resolveSnapshot(repoId: string, requested: string | undefined): Promise<SnapshotState> {
  try {
    if (requested !== undefined) {
      const manifest = await fetchOptionalJson(artifactPath(repoId, requested, "manifest.json"));
      if (manifest === undefined) return { status: "expired", requested };
      return { status: "ready", snapshotId: requested, source: "query" };
    }
    const answer = (await fetchOptionalJson(repoApiPath(repoId))) as
      | { snapshotId?: unknown; commitSha?: unknown }
      | undefined;
    if (answer === undefined) return { status: "never-indexed" };
    const snapshotId = parseSnapshotParam(typeof answer.snapshotId === "string" ? answer.snapshotId : undefined);
    if (snapshotId === undefined) return { status: "error", message: "The snapshot answer for this repository is malformed." };
    return {
      status: "ready",
      snapshotId,
      source: "latest",
      commitSha: typeof answer.commitSha === "string" ? answer.commitSha : undefined,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Could not reach the snapshot." };
  }
}

export function SnapshotProvider({ repoId, children }: { repoId: string; children: ReactNode }) {
  const searchParams = useSearchParams();
  // Read once: later URL writes (`?focus=`, `?level=`) must not change the session's snapshot.
  const requested = useRef(parseSnapshotParam(searchParams.get("snapshot"))).current;
  const [state, setState] = useState<SnapshotState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void resolveSnapshot(repoId, requested).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [repoId, requested]);

  return <SnapshotContext.Provider value={{ repoId, state }}>{children}</SnapshotContext.Provider>;
}

export function useSnapshot(): { repoId: string; state: SnapshotState } {
  const value = useContext(SnapshotContext);
  if (value === null) throw new Error("useSnapshot must be used inside a SnapshotProvider");
  return value;
}

/** The session's snapshot id, or `null` until it is resolved (and when there is none). */
export function useSnapshotId(): string | null {
  const { state } = useSnapshot();
  return state.status === "ready" ? state.snapshotId : null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      response.status === 404 ? "This part of the snapshot is not published." : `Request failed (${response.status}).`,
    );
  }
  return (await response.json()) as T;
}

/**
 * One JSON object of the session's snapshot, e.g. `views/zoom-map.json`. `path`
 * is relative to `artifacts/<owner>/<repo>/<snapshotId>/`; `null` skips the fetch. Snapshot objects
 * are immutable, so nothing revalidates.
 */
export function useSnapshotJson<T>(path: string | null) {
  const { repoId } = useSnapshot();
  const snapshotId = useSnapshotId();
  const { data, error, isLoading } = useSWR<T>(
    snapshotId !== null && path !== null ? artifactPath(repoId, snapshotId, path) : null,
    fetchJson<T>,
    { revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false },
  );
  // Until the snapshot id resolves there is nothing to fetch, which is loading, not idle.
  return { data, error, isLoading: isLoading || (snapshotId === null && path !== null && error === undefined) };
}
