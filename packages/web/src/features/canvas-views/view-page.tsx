"use client";

import type { ReactNode } from "react";
import { SnapshotNotice, ViewFailure, type ViewBodies, type ViewName } from "@repohive/design";
import { useRepository } from "@/features/host/repository-state";
import { useViewBody } from "./use-view-body";

export interface ViewPageProps<K extends ViewName> {
  /** The view body this page draws. */
  readonly view: K;
  /** What the page is called in its loading and failure lines ("the hierarchy"). */
  readonly what: string;
  /** The screen, given the loaded body and the repository. It may set the frame itself with `PageFrame`. */
  readonly children: (data: ViewBodies[K], repository: { readonly owner: string; readonly name: string }) => ReactNode;
}

/**
 * The route shell every canvas view shares: it reads the page's snapshot state and the view body, shows the notice for
 * every state that has nothing to draw, and hands the loaded body to the screen. Screens never fetch.
 */
export function ViewPage<K extends ViewName>({ view, what, children }: ViewPageProps<K>) {
  const repository = useRepository();
  const body = useViewBody(repository.snapshot, view);
  const { owner, name, snapshot } = repository;

  if (snapshot.status !== "ready") return <SnapshotNotice state={snapshot} owner={owner} name={name} what={what} />;
  if (body.status === "waiting") return <SnapshotNotice state={{ status: "loading" }} owner={owner} name={name} what={what} />;
  if (body.status === "error") return <ViewFailure what={what} message={body.message} />;
  return <>{children(body.data, { owner, name })}</>;
}
