"use client";

import { useEffect, useState } from "react";
import { useClient, type SnapshotState, type ViewBodies, type ViewName } from "@repohive/design";

export type ViewBodyState<K extends ViewName> =
  | { readonly status: "waiting" }
  | { readonly status: "ready"; readonly data: ViewBodies[K] }
  | { readonly status: "error"; readonly message: string };

/**
 * Reads one view body of the page's snapshot through the contract client, once the snapshot is known. Until the
 * snapshot is ready, or while the body loads, it answers `waiting`; a failed read answers `error` with the reason.
 */
export function useViewBody<K extends ViewName>(snapshot: SnapshotState, name: K): ViewBodyState<K> {
  const client = useClient();
  const [state, setState] = useState<ViewBodyState<K>>({ status: "waiting" });
  const snapshotId = snapshot.status === "ready" ? snapshot.snapshotId : undefined;

  useEffect(() => {
    if (snapshotId === undefined) return;
    let cancelled = false;
    setState({ status: "waiting" });
    client
      .view(snapshotId, name)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "The view could not be read." });
      });
    return () => {
      cancelled = true;
    };
  }, [client, snapshotId, name]);

  return state;
}
