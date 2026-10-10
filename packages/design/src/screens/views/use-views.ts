"use client";

import { useEffect, useState } from "react";
import type { ContractClient, ViewBodies, ViewName } from "../../contracts";
import { useClient } from "../../provider/design-provider";

/** A read in flight, finished, or failed. A screen shows each. */
export type Loaded<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: T }
  | { readonly status: "error"; readonly message: string };

/**
 * Runs a read through the injected client and keeps its answer. `key` names what is read: a new key starts a new read,
 * and an answer for an old key is dropped.
 */
export function useLoaded<T>(key: string, read: (client: ContractClient) => Promise<T>): Loaded<T> {
  const client = useClient();
  const [state, setState] = useState<{ readonly key: string; readonly value: Loaded<T> }>({ key, value: { status: "loading" } });

  useEffect(() => {
    let cancelled = false;
    read(client).then(
      (data) => {
        if (!cancelled) setState({ key, value: { status: "ready", data } });
      },
      (error: unknown) => {
        if (!cancelled) setState({ key, value: { status: "error", message: error instanceof Error ? error.message : "The data could not be read." } });
      },
    );
    return () => {
      cancelled = true;
    };
    // `read` is a closure over `key`'s inputs; the key is what says it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);

  return state.key === key ? state.value : { status: "loading" };
}

/** Loads the named view bodies of one snapshot together. */
export function useSnapshotViews<K extends ViewName>(snapshotId: string, names: readonly K[]): Loaded<Pick<ViewBodies, K>> {
  return useLoaded(`${snapshotId}:${names.join(",")}`, async (client) => {
    const bodies = await Promise.all(names.map((name) => client.view(snapshotId, name)));
    const result: Partial<Pick<ViewBodies, K>> = {};
    names.forEach((name, index) => {
      result[name] = bodies[index] as ViewBodies[K];
    });
    return result as Pick<ViewBodies, K>;
  });
}
