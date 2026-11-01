"use client";

import { useEffect, useState } from "react";
import { useClient, type SnapshotState, type ViewBodies, type ViewName } from "@repohive/design";

export type ViewBodyState<K extends ViewName> =
  | { readonly status: "waiting" }
  | { readonly status: "ready"; readonly data: ViewBodies[K] }
  | { readonly status: "error"; readonly message: string };

const WAITING = { status: "waiting" } as const;

/**
 * Reads one view body of the page's snapshot through the contract client, once the snapshot is known. Until the
 * snapshot is ready, or while the body loads, it answers `waiting`; a failed read answers `error` with the reason.
 * Each result is kept with the snapshot and view it was read for, so a change of either answers `waiting` until its
 * own read settles, without resetting state inside the effect.
 */
export function useViewBody<K extends ViewName>(snapshot: SnapshotState, name: K): ViewBodyState<K> {
  const client = useClient();
  const [settled, setSettled] = useState<{ readonly key: string; readonly state: ViewBodyState<K> }>();
  const snapshotId = snapshot.status === "ready" ? snapshot.snapshotId : undefined;
  const key = snapshotId === undefined ? undefined : `${snapshotId}\u0000${name}`;

  useEffect(() => {
    if (snapshotId === undefined) return;
    const forKey = `${snapshotId}\u0000${name}`;
    let cancelled = false;
    client
      .view(snapshotId, name)
      .then((data) => {
        if (!cancelled) setSettled({ key: forKey, state: { status: "ready", data } });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSettled({
            key: forKey,
            state: { status: "error", message: error instanceof Error ? error.message : "The view could not be read." },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, snapshotId, name]);

  return key !== undefined && settled?.key === key ? settled.state : WAITING;
}
