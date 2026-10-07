"use client";

import { useEffect, useState } from "react";
import { LinkButton } from "../../components/button";
import { Alert, EmptyState, Page, Text } from "../../components/feedback";
import { KeyValueList, Panel } from "../../components/panel";
import { StatusTag } from "../../components/status";
import { JOB_STATES, isTerminalJobState, type Job, type JobState } from "../../contracts";
import { useClient } from "../../provider/design-provider";
import { routes } from "../../routes";
import { describeFailureCode, formatCount, repoIdFromJobRepo } from "../dashboard/format";
import { JOB_STATE_LABEL, jobStateWord, jobTone, stageLabel } from "../dashboard/job-labels";

/** What the Job page is showing. `useJobState` reads it and the screen draws it. */
export type JobPageState =
  | { readonly status: "loading" }
  | { readonly status: "not-found" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly job: Job };

/** The stages in the order a job passes through them: every state before the two end states. */
const STAGES: readonly JobState[] = JOB_STATES.filter((state) => !isTerminalJobState(state));

/**
 * Reads one job and follows it until it ends. A job that is already over is read once; a running one is followed
 * through its event stream, and the page stops following when it is left.
 */
export function useJobState(jobId: string): JobPageState {
  const client = useClient();
  const [state, setState] = useState<{ readonly jobId: string; readonly value: JobPageState }>({ jobId, value: { status: "loading" } });

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    const set = (value: JobPageState): void => {
      if (!cancelled) setState({ jobId, value });
    };
    client.job(jobId).then(
      (job) => {
        if (cancelled) return;
        if (job === undefined) {
          set({ status: "not-found" });
          return;
        }
        set({ status: "ready", job });
        if (isTerminalJobState(job.state)) return;
        stop = client.watchJob(
          jobId,
          (event) => {
            const { jobId: _ignored, ...next } = event.data;
            void _ignored;
            set({ status: "ready", job: next });
          },
          () => undefined,
        );
      },
      (error: unknown) => set({ status: "failed", message: error instanceof Error ? error.message : "The job could not be read." }),
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [client, jobId]);

  return state.jobId === jobId ? state.value : { status: "loading" };
}

type StepKind = "done" | "cur" | "fail" | "pending";

/** Where each stage stands. A failed job's stage is known only when the ledger recorded it as the progress stage. */
function stepKinds(job: Job): StepKind[] {
  if (job.state === "succeeded") return STAGES.map(() => "done");
  const recorded = job.state === "failed" ? STAGES.indexOf((job.progress?.stage ?? "") as JobState) : STAGES.indexOf(job.state);
  if (recorded < 0) return STAGES.map(() => "pending");
  return STAGES.map((_stage, index) => (index < recorded ? "done" : index === recorded ? (job.state === "failed" ? "fail" : "cur") : "pending"));
}

const STEP_WORD: Readonly<Record<StepKind, string>> = { done: "Done", cur: "In progress", fail: "Failed", pending: "Not reached" };

export interface JobScreenProps {
  readonly jobId: string;
  readonly state: JobPageState;
}

/** The Job page: where one indexing job is, what it produced, and why it stopped when it did. Every value is the job's record. */
export function JobScreen({ jobId, state }: JobScreenProps) {
  if (state.status === "loading") {
    return (
      <Page narrow>
        <p className="rh-fg3 rh-v-loading" role="status">
          Loading the job…
        </p>
      </Page>
    );
  }
  if (state.status === "not-found") {
    return (
      <Page narrow>
        <EmptyState
          title="There is no such job"
          action={
            <LinkButton variant="primary" href={routes.activity}>
              Open Activity
            </LinkButton>
          }
        >
          The link may be old, or the job may have been removed.
        </EmptyState>
      </Page>
    );
  }
  if (state.status === "failed") {
    return (
      <Page narrow>
        <Alert title="This job could not be loaded">{state.message}</Alert>
      </Page>
    );
  }

  const { job } = state;
  const kinds = stepKinds(job);
  const repoId = repoIdFromJobRepo(job.repo);
  const [owner, name] = repoId.split("/");
  const progress = job.progress;
  const counted = progress?.completed !== undefined && progress.total !== undefined && progress.total > 0;

  return (
    <Page narrow>
      <header className="rh-v-head">
        <div>
          <span className="rh-fg3">
            Job <span className="rh-mono">{jobId}</span>
          </span>
          <Text as="h1" role="heading">
            {repoId}
          </Text>
          <StatusTag tone={jobTone(job.state)}>{jobStateWord(job.state)}</StatusTag>
        </div>
      </header>

      {job.failure === undefined ? null : (
        <Alert title={<>Failed: <span className="rh-mono">{job.failure.code}</span></>}>
          {job.failure.message ?? describeFailureCode(job.failure.code)}
        </Alert>
      )}

      <div className="rh-job-grid">
        <Panel
          title="Stages"
          actions={
            counted ? (
              <Text role="caption" tone="subtle" className="rh-mono">
                {formatCount(progress.completed ?? 0)} / {formatCount(progress.total ?? 0)}
              </Text>
            ) : undefined
          }
        >
          <ol className="rh-stepper">
            {STAGES.map((stage, index) => {
              const kind = kinds[index] ?? "pending";
              return (
                <li key={stage} className={`rh-step-${kind}`} aria-current={kind === "cur" ? "step" : undefined}>
                  <span className="rh-step-ic" aria-hidden />
                  <span>{JOB_STATE_LABEL[stage]}</span>
                  <span className="rh-t-caption rh-fg3">{STEP_WORD[kind]}</span>
                </li>
              );
            })}
          </ol>
          {progress === undefined || progress.stage === job.state ? null : (
            <Text role="caption" tone="subtle">
              Last recorded stage: {stageLabel(progress.stage)}
            </Text>
          )}
        </Panel>

        <div className="rh-ad-stack">
          <Panel title="Details">
            <KeyValueList
              items={[
                { label: "Repository", value: repoId },
                { label: "State", value: JOB_STATE_LABEL[job.state] },
                ...(job.result === undefined ? [] : [{ label: "Snapshot", value: <span className="rh-mono">{job.result.snapshotId.slice(0, 8)}</span> }]),
              ]}
            />
            {isTerminalJobState(job.state) ? null : (
              <Text role="caption" tone="subtle">
                A job finishes on its own. Leaving this page does not stop it.
              </Text>
            )}
          </Panel>

          {job.result === undefined || owner === undefined || name === undefined ? null : (
            <Panel
              title="Result"
              actions={
                <LinkButton size="sm" variant="primary" href={routes.repo(owner, name)}>
                  Open
                </LinkButton>
              }
            >
              <Text role="caption" tone="subtle">
                The snapshot is published. Its views open from the repository.
              </Text>
            </Panel>
          )}
        </div>
      </div>
    </Page>
  );
}
