"use client";

import type { ReactNode } from "react";
import type { RepositoryRef, SnapshotState } from "../../contracts";
import { LinkButton } from "../../components/button";
import { Alert, EmptyState, Page } from "../../components/feedback";
import { routes } from "../../routes";
import type { Loaded } from "./use-views";

/** What a repository page shows while its data is on the way. */
export function ViewLoading({ what }: { readonly what: string }) {
  return (
    <Page>
      <p className="rh-v-loading rh-fg3" role="status">
        Loading {what}…
      </p>
    </Page>
  );
}

export function ViewFailure({ message }: { readonly message: string }) {
  return (
    <Page>
      <Alert title="This view could not be loaded">{message}</Alert>
    </Page>
  );
}

export interface SnapshotGateProps extends RepositoryRef {
  readonly snapshot: SnapshotState;
  /** What the page is called while it loads: "the overview". */
  readonly what: string;
  /** Renders once the snapshot is known to exist. */
  readonly children: (snapshotId: string) => ReactNode;
}

/**
 * The states a repository page has before it has a snapshot: loading, never indexed, expired, failed. Each says what
 * happened and what to do; only `ready` reaches the screen.
 */
export function SnapshotGate({ owner, name, snapshot, what, children }: SnapshotGateProps) {
  switch (snapshot.status) {
    case "loading":
      return <ViewLoading what={what} />;
    case "never-indexed":
      return (
        <Page>
          <EmptyState
            title="This repository has not been indexed"
            action={
              <LinkButton variant="primary" href={routes.repos}>
                Back to repositories
              </LinkButton>
            }
          >
            Nothing is published for {owner}/{name} yet. Request an index from the repositories page and its views will appear here.
          </EmptyState>
        </Page>
      );
    case "expired":
      return (
        <Page>
          <EmptyState
            title="That snapshot is no longer published"
            action={
              <LinkButton variant="primary" href={routes.repo(owner, name)}>
                Open the latest snapshot
              </LinkButton>
            }
          >
            The link names a snapshot that has been replaced or removed.
          </EmptyState>
        </Page>
      );
    case "error":
      return <ViewFailure message={snapshot.message} />;
    case "ready":
      return <>{children(snapshot.snapshotId)}</>;
  }
}

/** Renders a loaded read: the loading line, the failure, or the data. */
export function Await<T>({ loaded, what, children }: { readonly loaded: Loaded<T>; readonly what: string; readonly children: (data: T) => ReactNode }) {
  if (loaded.status === "loading") return <ViewLoading what={what} />;
  if (loaded.status === "error") return <ViewFailure message={loaded.message} />;
  return <>{children(loaded.data)}</>;
}
