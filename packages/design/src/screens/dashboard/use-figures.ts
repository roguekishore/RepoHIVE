"use client";

import { useEffect, useState } from "react";
import type { ContractClient } from "../../contracts";
import { useClient } from "../../provider/design-provider";
import { figuresFromAdaptivity, type RepoFigures } from "./figures";

/** How many snapshots are read at once: a page of cards should not open fifty connections. */
export const FIGURES_CONCURRENCY = 6;

/** A snapshot never changes once published, so what was read for one client is kept for the page's life. */
const cache = new WeakMap<ContractClient, Map<string, Promise<RepoFigures | null>>>();

function readFigures(client: ContractClient, snapshotId: string): Promise<RepoFigures | null> {
  let perClient = cache.get(client);
  if (perClient === undefined) {
    perClient = new Map();
    cache.set(client, perClient);
  }
  let pending = perClient.get(snapshotId);
  if (pending === undefined) {
    pending = client
      .view(snapshotId, "adaptivity")
      .then((view) => figuresFromAdaptivity(view) ?? null)
      // A snapshot that cannot be read leaves its card with the figures the list carries; it is not an error to show.
      .catch(() => null);
    perClient.set(snapshotId, pending);
  }
  return pending;
}

/**
 * The figures of each snapshot, read lazily from its `adaptivity` view, a few at a time and in the order given.
 * A snapshot that has not been read yet is absent from the map; one that could not be read is `null`.
 */
export function useRepoFigures(snapshotIds: readonly string[]): ReadonlyMap<string, RepoFigures | null> {
  const client = useClient();
  const [figures, setFigures] = useState<ReadonlyMap<string, RepoFigures | null>>(new Map());
  const key = snapshotIds.join(",");

  useEffect(() => {
    let cancelled = false;
    const queue = [...new Set(key === "" ? [] : key.split(","))];
    const worker = async (): Promise<void> => {
      for (let id = queue.shift(); id !== undefined && !cancelled; id = queue.shift()) {
        const found = await readFigures(client, id);
        if (cancelled) return;
        const snapshotId = id;
        setFigures((previous) => (previous.has(snapshotId) ? previous : new Map(previous).set(snapshotId, found)));
      }
    };
    for (let i = 0; i < FIGURES_CONCURRENCY; i += 1) void worker();
    return () => {
      cancelled = true;
    };
  }, [client, key]);

  return figures;
}
