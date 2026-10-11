"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "../../components/button";
import { Chip } from "../../components/controls";
import { Alert, EmptyState, Page, Text } from "../../components/feedback";
import { Panel } from "../../components/panel";
import { StatusTag } from "../../components/status";
import { Table, type TableColumn } from "../../components/table";
import type { JobList, JobListItem } from "../../contracts";
import { Icon } from "../../icons/icons";
import { useLink, useNavigate } from "../../provider/design-provider";
import { routes } from "../../routes";
import type { RepoFigures } from "./figures";
import { describeFailureCode, formatCount, formatElapsed, formatWhen, repoIdFromJobRepo } from "./format";
import type { DashboardFrame } from "./frame-prop";
import { IndexRequestDialog } from "./index-dialog";
import { isInProgress, jobStateWord, jobTone, stageLabel } from "./job-labels";
import { useRepoFigures } from "./use-figures";

export interface ActivityProps {
  readonly Frame: DashboardFrame;
  /** The signed-in account's jobs; `undefined` while they load or when signed out. */
  readonly jobs?: JobList;
  /** `false` once the host has said nobody is signed in. */
  readonly signedIn?: boolean;
  readonly error?: string;
  /** The clock the "today" and "yesterday" wording reads; a test fixes it. */
  readonly now?: Date;
}

type ActivityFilter = "all" | "active" | "attention";

const FILTERS: readonly { readonly value: ActivityFilter; readonly label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "In progress" },
  { value: "attention", label: "Needs attention" },
];

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <Text role="heading" figure>
        {formatCount(value)}
      </Text>
      <Text role="caption" tone="subtle">
        {label}
      </Text>
    </div>
  );
}

function ProgressCell({ job }: { job: JobListItem }): ReactNode {
  const { completed, total } = job.progress ?? {};
  if (isInProgress(job) && job.state !== "queued" && job.state !== "waiting-for-slot") {
    if (completed !== undefined && total !== undefined && total > 0) {
      return (
        <div
          className="rh-bar rh-act-bar"
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
        >
          <i className="rh-bar-progress" style={{ width: `${Math.min(1, completed / total) * 100}%` }} />
        </div>
      );
    }
    return <Text role="caption" tone="subtle">{stageLabel(job.state)}</Text>;
  }
  if (job.state === "queued") return <Text role="caption" tone="subtle">In the queue</Text>;
  if (job.state === "waiting-for-slot") return <Text role="caption" tone="subtle">Waiting for a slot</Text>;
  if (job.state === "failed") {
    return (
      <Text role="caption" tone="subtle">
        {job.progress === undefined ? describeFailureCode(job.failure?.code ?? "failed") : `Stopped at ${stageLabel(job.progress.stage).toLowerCase()}`}
      </Text>
    );
  }
  return (
    <div className="rh-bar rh-act-bar">
      <i className="rh-bar-kept" style={{ width: "100%" }} />
    </div>
  );
}

/**
 * Activity: the signed-in account's jobs, newest first, with the four counts of the list, a filter and a table. Every
 * cell is a recorded value; where the ledger recorded nothing the cell is a dash.
 */
export function Activity({ Frame, jobs, signedIn, error, now: nowProp }: ActivityProps) {
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);
  const navigate = useNavigate();
  const Link = useLink();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [dialog, setDialog] = useState(false);

  const items = useMemo(() => jobs?.items ?? [], [jobs]);
  const succeededSnapshots = useMemo(() => items.flatMap((job) => (job.result === undefined ? [] : [job.result.snapshotId])), [items]);
  const figures = useRepoFigures(succeededSnapshots);
  const figuresOf = (job: JobListItem): RepoFigures | undefined =>
    job.result === undefined ? undefined : (figures.get(job.result.snapshotId) ?? undefined);

  const rows = useMemo(
    () =>
      items.filter((job) =>
        filter === "all" ? true : filter === "active" ? isInProgress(job) : job.state === "failed",
      ),
    [items, filter],
  );

  const columns: TableColumn<JobListItem>[] = [
    { key: "repo", header: "Repository", render: (job) => <span className="rh-act-name">{repoIdFromJobRepo(job.repo)}</span> },
    {
      key: "state",
      header: "State",
      render: (job) => <StatusTag tone={jobTone(job.state)}>{jobStateWord(job.state)}</StatusTag>,
    },
    { key: "progress", header: "Progress", width: "22%", render: (job) => <ProgressCell job={job} /> },
    {
      key: "files",
      header: "Files",
      numeric: true,
      render: (job) => {
        const { completed, total } = job.progress ?? {};
        if (isInProgress(job)) {
          return completed !== undefined && total !== undefined ? `${formatCount(completed)} / ${formatCount(total)}` : "-";
        }
        const known = figuresOf(job);
        return known === undefined ? "-" : formatCount(known.files);
      },
    },
    { key: "requested", header: "Requested", render: (job) => <span className="rh-fg2">{formatWhen(job.requestedAt, now)}</span> },
    {
      key: "elapsed",
      header: "Elapsed",
      numeric: true,
      render: (job) => (job.endedAt === undefined ? "-" : (formatElapsed(job.requestedAt, job.endedAt) ?? "-")),
    },
  ];

  const actions = useMemo(
    () => (
      <Button size="sm" variant="primary" onClick={() => setDialog(true)}>
        <Icon name="plus" size={14} />
        <span className="rh-hide-sm">Index a repository</span>
      </Button>
    ),
    [],
  );

  let body: ReactNode;
  if (error !== undefined) {
    body = <Alert title="Your activity could not be loaded">{error}</Alert>;
  } else if (signedIn === false) {
    body = (
      <EmptyState
        title="Sign in to see your activity"
        action={
          <Link className="rh-btn rh-btn-primary" href={routes.signIn}>
            Sign in
          </Link>
        }
      >
        Activity lists the indexing jobs you have requested.
      </EmptyState>
    );
  } else if (jobs === undefined) {
    body = (
      <p className="rh-t-caption rh-fg3" role="status">
        Loading activity
      </p>
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        title="No jobs yet"
        action={
          <Button onClick={() => setDialog(true)}>
            <Icon name="plus" size={14} />
            Index a repository
          </Button>
        }
      >
        Jobs you request appear here while the service keeps them.
      </EmptyState>
    );
  } else {
    const weekAgo = now.getTime() - 7 * 86_400_000;
    const thisWeek = items.filter((job) => new Date(job.requestedAt).getTime() >= weekAgo).length;
    const finished = items.filter((job) => job.state === "succeeded").length;
    const active = items.filter(isInProgress).length;
    const failed = items.filter((job) => job.state === "failed").length;
    body = (
      <>
        <div className="rh-act-figs">
          <Figure value={thisWeek} label="requests this week" />
          <Figure value={finished} label="finished" />
          <Figure value={active} label="in progress" />
          <Figure value={failed} label="failed" />
        </div>
        <div className="rh-dash-tools" role="group" aria-label="Filter">
          {FILTERS.map((option) => (
            <Chip key={option.value} pressed={filter === option.value} onClick={() => setFilter(option.value)}>
              {option.label}
            </Chip>
          ))}
        </div>
        <Panel padded={false}>
          <Table
            caption="Your indexing jobs"
            columns={columns}
            rows={rows}
            rowKey={(job) => job.jobId}
            onRowActivate={(job) => navigate(routes.job(job.jobId))}
            empty={
              <p className="rh-act-none rh-fg3">Nothing here. Every job finished cleanly.</p>
            }
          />
        </Panel>
      </>
    );
  }

  return (
    <Frame crumbs={[{ label: "Activity" }]} actions={actions}>
      <Page>{body}</Page>
      <IndexRequestDialog open={dialog} onClose={() => setDialog(false)} />
    </Frame>
  );
}
