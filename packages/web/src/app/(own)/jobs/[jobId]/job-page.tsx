"use client";

import { useParams } from "next/navigation";
import { useMemo } from "react";
import { JobScreen, LinkButton, routes, useJobState } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";

/** The Job page's route shell: follows the job named in the URL, and puts the repository in the crumbs and the top bar. */
export function JobPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId ?? "";
  const state = useJobState(jobId);
  const repoId = state.status === "ready" ? state.job.repo.replace(/^github\.com\//i, "").toLowerCase() : undefined;
  const [owner, name] = repoId?.split("/") ?? [];

  const crumbs = useMemo(
    () => [{ label: "Activity", href: routes.activity }, { label: repoId ?? "Job" }],
    [repoId],
  );
  const actions = useMemo(
    () =>
      state.status === "ready" && state.job.result !== undefined && owner !== undefined && name !== undefined ? (
        <LinkButton size="sm" variant="primary" href={routes.repo(owner, name)}>
          Open repository
        </LinkButton>
      ) : undefined,
    [state, owner, name],
  );

  return (
    <PageFrame crumbs={crumbs} actions={actions}>
      <JobScreen jobId={jobId} state={state} />
    </PageFrame>
  );
}
