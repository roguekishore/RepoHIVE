import type { ReactNode } from "react";
import { EmptyState, Page } from "../../components/feedback";
import { Alert } from "../../components/feedback";
import { LinkButton } from "../../components/button";
import { routes } from "../../routes";
import type { SnapshotState } from "../../contracts";

export interface SnapshotNoticeProps {
  readonly state: Exclude<SnapshotState, { status: "ready" }>;
  readonly owner: string;
  readonly name: string;
  /** What is being loaded, for the loading line ("the hierarchy"). */
  readonly what: string;
}

/**
 * What a repository view shows before it has a snapshot to draw: loading, never indexed, an expired link, or a failure.
 * The Screens artifact has no such state, so these are built from its empty-state and alert components.
 */
export function SnapshotNotice({ state, owner, name, what }: SnapshotNoticeProps) {
  return (
    <Page narrow>
      <SnapshotNoticeBody state={state} owner={owner} name={name} what={what} />
    </Page>
  );
}

function SnapshotNoticeBody({ state, owner, name, what }: SnapshotNoticeProps): ReactNode {
  switch (state.status) {
    case "loading":
      return (
        <div className="rh-empty" role="status">
          <strong>{`Loading ${what}`}</strong>
        </div>
      );
    case "never-indexed":
      return (
        <EmptyState
          title="This repository has not been indexed"
          action={
            <LinkButton href={routes.repos} size="sm">
              Repositories
            </LinkButton>
          }
        >
          {`${owner}/${name} has no snapshot yet, so there is nothing to draw.`}
        </EmptyState>
      );
    case "expired":
      return (
        <EmptyState
          title="That snapshot is no longer published"
          action={
            <LinkButton href={routes.repo(owner, name)} size="sm">
              Open the latest
            </LinkButton>
          }
        >
          {`The link names snapshot ${state.requested}, which has been replaced.`}
        </EmptyState>
      );
    case "error":
      return <Alert title="Could not read this repository">{state.message}</Alert>;
  }
}

/** Shown when a view body fails to load or does not parse. */
export function ViewFailure({ what, message }: { readonly what: string; readonly message: string }) {
  return (
    <Page narrow>
      <Alert title={`Could not load ${what}`}>{message}</Alert>
    </Page>
  );
}
