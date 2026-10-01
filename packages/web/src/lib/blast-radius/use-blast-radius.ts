"use client";

/**
 * The page-side handle on the blast-radius session (hosting-3 Requirement 4):
 * one session per snapshot id, created lazily so the view is fetched on first
 * use, and disposed (worker terminated) when the page unmounts.
 */
import { useCallback, useEffect, useRef } from "react";
import { useSnapshotId } from "@/lib/snapshot/snapshot-context";
import { createBlastRadiusSession, type BlastRadiusSession } from "./client";
import type { BlastRadiusResult } from "./traverse";

/** `null` result: the node is not in the snapshot. Rejects when the view cannot be loaded. */
export function useBlastRadius(): (node: string) => Promise<BlastRadiusResult | null> {
  const snapshotId = useSnapshotId();
  const session = useRef<{ snapshotId: string; session: BlastRadiusSession }>(undefined);

  useEffect(
    () => () => {
      session.current?.session.dispose();
      session.current = undefined;
    },
    [],
  );

  return useCallback(
    (node) => {
      if (snapshotId === null) return Promise.resolve(null);
      if (session.current?.snapshotId !== snapshotId) {
        session.current?.session.dispose();
        session.current = { snapshotId, session: createBlastRadiusSession({ snapshotId }) };
      }
      return session.current.session.query(node);
    },
    [snapshotId],
  );
}
