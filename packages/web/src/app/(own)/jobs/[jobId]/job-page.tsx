"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, Icon, IndexRequestDialog, JobScreen, LinkButton, routes, useJobState } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";

/** The Job page's route shell: follows the job named in the URL, and puts the repository in the crumbs and the top bar. */
export function JobPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId ?? "";
  const state = useJobState(jobId);
  const [retrying, setRetrying] = useState(false);
  const repoId = state.status === "ready" ? state.job.repo.replace(/^github\.com\//i, "").toLowerCase() : undefined;
  const [owner, name] = repoId?.split("/") ?? [];

  const crumbs = useMemo(
    () => [{ label: "Activity", href: routes.activity }, { label: repoId ?? "Job" }],
    [repoId],
  );
  const failed = state.status === "ready" && state.job.state === "failed";
  const actions = useMemo(() => {
    if (state.status === "ready" && state.job.result !== undefined && owner !== undefined && name !== undefined) {
      return (
        <LinkButton size="sm" variant="primary" href={routes.repo(owner, name)}>
          Open repository
        </LinkButton>
      );
    }
    return failed ? (
      <Button size="sm" onClick={() => setRetrying(true)}>
        <Icon name="refresh" size={14} />
        Retry
      </Button>
    ) : undefined;
  }, [state, owner, name, failed]);

  return (
    <PageFrame crumbs={crumbs} actions={actions}>
      <JobScreen jobId={jobId} state={state} />
      {failed && repoId !== undefined ? <IndexRequestDialog open={retrying} onClose={() => setRetrying(false)} initialRepo={repoId} /> : null}
    </PageFrame>
  );
}
