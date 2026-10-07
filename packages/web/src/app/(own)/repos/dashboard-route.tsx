"use client";

import { useEffect, useState } from "react";
import { Dashboard, useClient, type JobList, type RepositoryListItem } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";

/** Reads every page of the repository list (50 a page), then the signed-in account's jobs when there is a session. */
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
        const items = [...first.items];
        for (let page = 2; page <= first.totalPages; page += 1) {
          items.push(...(await client.listRepositories(page)).items);
        }
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
