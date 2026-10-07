"use client";

import { useEffect, useState } from "react";
import { Dashboard, useClient, type JobList, type RepositoryListItem } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";

/**
 * Reads every page of the repository list (50 a page, the rest after the first in parallel), then the signed-in
 * account's jobs when there is a session. The list rows are small; the dashboard draws them a page at a time.
 */
export function DashboardRoute() {
  const client = useClient();
  const [repositories, setRepositories] = useState<readonly RepositoryListItem[] | undefined>();
  const [jobs, setJobs] = useState<JobList | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const first = await client.listRepositories(1);
        const rest = await Promise.all(
          Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) => client.listRepositories(index + 2)),
        );
        const items = [...first.items, ...rest.flatMap((next) => next.items)];
        if (live) setRepositories(items);
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : "The repository list could not be read.");
      }
      try {
        const list = await client.jobs();
        if (live) setJobs(list);
      } catch {
        // The jobs only add running and failed status; the list stands without them.
      }
    })();
    return () => {
      live = false;
    };
  }, [client]);

  return <Dashboard Frame={PageFrame} repositories={repositories} jobs={jobs} error={error} />;
}
