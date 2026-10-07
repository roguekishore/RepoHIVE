"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { PublicJobResponse } from "@/server/intake/job-response";
import { repoKeyToViewerPath } from "@/server/worker/repositories";

interface JobEventData {
  readonly state?: PublicJobResponse["state"];
  readonly progress?: PublicJobResponse["progress"];
  readonly result?: { readonly snapshotId: string };
  readonly failure?: { readonly code: string };
}

function isTerminalJobState(state: PublicJobResponse["state"]): boolean {
  return state === "succeeded" || state === "failed";
}

async function fetchJob(jobId: string): Promise<PublicJobResponse | undefined> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error("Could not load the job.");
  }
  return (await response.json()) as PublicJobResponse;
}

export default function JobProgressPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId ?? "";
  const [job, setJob] = useState<PublicJobResponse | undefined>();
  const [live, setLive] = useState<JobEventData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJob(jobId)
      .then((loaded) => {
        if (!cancelled) {
          setJob(loaded);
        }
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Could not load the job.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (job === undefined) {
      return;
    }
    if (isTerminalJobState(job.state)) {
      return;
    }
    const source = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
    source.addEventListener("progress", (event) => {
      try {
        setLive(JSON.parse((event as MessageEvent).data) as JobEventData);
      } catch {
        // Ignore malformed frames.
      }
    });
    source.addEventListener("done", (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as JobEventData;
        setLive(parsed);
        void fetchJob(jobId).then(setJob);
      } catch {
        // Ignore malformed frames.
      }
      source.close();
    });
    source.onerror = () => {
      source.close();
    };
    return () => {
      source.close();
    };
  }, [job, jobId]);

  const view = useMemo(() => {
    if (live?.state !== undefined) {
      return { ...job, state: live.state, progress: live.progress ?? job?.progress, result: live.result, failure: live.failure };
    }
    return job;
  }, [job, live]);

  if (error !== null) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <p role="alert">{error}</p>
      </main>
    );
  }

  if (view === undefined) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <p aria-live="polite">Loading job…</p>
      </main>
    );
  }

  const repoPath = repoKeyToViewerPath(view.repo ?? "");
  const parsing =
    view.state === "parsing" && view.progress?.completed !== undefined && view.progress.total !== undefined
      ? `${view.progress.completed} / ${view.progress.total} files`
      : null;

  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-lg font-medium">Index progress</h1>
      <p className="text-sm text-[var(--color-text-secondary)]">{view.repo}</p>
      <div aria-live="polite" className="rounded border border-[var(--color-border-subtle)] p-4 text-sm">
        <p>
          <span className="font-medium">Stage:</span> {view.progress?.stage ?? view.state}
        </p>
        {parsing !== null ? (
          <p>
            <span className="font-medium">Parsing:</span> {parsing}
          </p>
        ) : null}
        {view.state === "failed" ? (
          <p role="alert">{view.failure?.code ?? "The index failed."}</p>
        ) : null}
      </div>
      {view.state === "succeeded" && repoPath !== undefined ? (
        <Link className="text-sm underline" href={repoPath}>
          Open repository pages
        </Link>
      ) : null}
    </main>
  );
}
