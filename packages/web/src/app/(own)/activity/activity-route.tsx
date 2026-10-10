"use client";

import { useEffect, useState } from "react";
import { Activity, useClient, type JobList } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";

/** The signed-in account's jobs; a signed-out visitor gets the sign-in prompt, not an empty list. */
export function ActivityRoute() {
  const client = useClient();
  const [jobs, setJobs] = useState<JobList | undefined>();
  const [signedIn, setSignedIn] = useState<boolean | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    client
      .jobs()
      .then((list) => {
        if (!live) return;
        setSignedIn(list !== undefined);
        setJobs(list);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : "The job list could not be read.");
      });
    return () => {
      live = false;
    };
  }, [client]);

  return <Activity Frame={PageFrame} jobs={jobs} signedIn={signedIn} error={error} />;
}
