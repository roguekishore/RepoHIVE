/**
 * Type tests for the contract. `tsc --noEmit` (the package's `test` script runs it first) is what checks them: an
 * assertion that fails is a compile error, and so is an `@ts-expect-error` that no longer expects one. The first group
 * pins the contract to the types the servers and the view builders really use, so a change on either side breaks here.
 */
import type { JobProgress as IndexerProgress, JobState as IndexerState, LatestPointer, Manifest } from "@repohive/indexer";
import type { SnapshotViews } from "@repohive/views";
import { expectTypeOf } from "vitest";
import type {
  ActionResult,
  ContractClient,
  IndexRequestResult,
  Job,
  JobEvent,
  JobProgress,
  JobState,
  Quota,
  RepositoryListItem,
  RepositoryPage,
  RepositorySummary,
  Session,
  SnapshotManifest,
  SnapshotPointer,
  SnapshotState,
  ViewBodies,
  ViewName,
} from "./index";

// --- pinned to the real types ---

expectTypeOf<JobState>().toEqualTypeOf<IndexerState>();
expectTypeOf<IndexerProgress>().toExtend<JobProgress>();
expectTypeOf<JobProgress>().toExtend<IndexerProgress>();
expectTypeOf<Manifest>().toExtend<SnapshotManifest>();
expectTypeOf<LatestPointer>().toExtend<SnapshotPointer>();
// A job record's public view is the contract's Job; the record itself is not.
expectTypeOf<Job["state"]>().toEqualTypeOf<IndexerState>();

// Every view body is exactly what the builders return.
expectTypeOf<ViewBodies["repo"]>().toEqualTypeOf<SnapshotViews["repo"]>();
expectTypeOf<ViewBodies["regionDecisions"]>().toEqualTypeOf<SnapshotViews["regionDecisions"]>();
expectTypeOf<ViewBodies["zoomMap"]>().toEqualTypeOf<SnapshotViews["zoomMap"]>();
expectTypeOf<ViewBodies["architecture"]>().toEqualTypeOf<SnapshotViews["architecture"]>();
expectTypeOf<keyof ViewBodies>().toEqualTypeOf<ViewName>();

// --- shapes ---

expectTypeOf<Session>().toEqualTypeOf<{ readonly signedIn: boolean; readonly email?: string }>();
expectTypeOf<Quota>().toEqualTypeOf<{
  readonly remainingAccount: number;
  readonly remainingIp: number;
  readonly limitAccount: number;
  readonly limitIp: number;
}>();
expectTypeOf<RepositoryListItem>().toEqualTypeOf<{
  readonly repoKey: string;
  readonly repoId: string;
  readonly snapshotId: string;
  readonly commitSha: string;
  readonly indexedAt: string;
  readonly nodeCount: number;
}>();
expectTypeOf<RepositoryPage["items"]>().toEqualTypeOf<readonly RepositoryListItem[]>();
// A field a host may not record is optional, so the screen has to handle its absence.
expectTypeOf<RepositorySummary["edgeCount"]>().toEqualTypeOf<number | undefined>();
expectTypeOf<Pick<RepositorySummary, "nodeCount">["nodeCount"]>().toEqualTypeOf<number>();

// --- the client ---

declare const client: ContractClient;
expectTypeOf(client.view("s", "repo" as const)).toEqualTypeOf<Promise<SnapshotViews["repo"]>>();
expectTypeOf(client.view("s", "zoomMap" as const)).toEqualTypeOf<Promise<SnapshotViews["zoomMap"]>>();
expectTypeOf(client.quota).returns.toEqualTypeOf<Promise<Quota | undefined>>();
expectTypeOf(client.requestIndex).returns.toEqualTypeOf<Promise<IndexRequestResult>>();
expectTypeOf(client.signIn).returns.toEqualTypeOf<Promise<ActionResult>>();
expectTypeOf(client.watchJob).returns.toEqualTypeOf<() => void>();
expectTypeOf(client.watchJob).parameter(1).toEqualTypeOf<(event: JobEvent) => void>();

// @ts-expect-error: "nope" is not a view
client.view("s", "nope");
// @ts-expect-error: a repository takes an owner and a name
client.repository("only-one");

// --- unions a screen must handle completely ---

function assertNever(value: never): never {
  throw new Error(`unhandled ${String(value)}`);
}

export function describeSnapshot(state: SnapshotState): string {
  switch (state.status) {
    case "loading":
      return "loading";
    case "never-indexed":
      return "never indexed";
    case "expired":
      return state.requested;
    case "error":
      return state.message;
    case "ready":
      return state.snapshotId;
    default:
      return assertNever(state);
  }
}

export function describeIndexResult(result: IndexRequestResult): string {
  switch (result.status) {
    case "cached":
      return result.snapshotId;
    case "joined":
    case "accepted":
      return result.jobId;
    case "busy":
      return String(result.retryAfterSeconds);
    case "rejected":
      return result.message;
    default:
      return assertNever(result);
  }
}

export function describeAction(result: ActionResult): string {
  return result.ok ? "ok" : result.error.message;
}

// @ts-expect-error: a ready snapshot needs its id
const missingId: SnapshotState = { status: "ready", source: "latest" };
// @ts-expect-error: a failure has a code
const noCode: Job = { repo: "o/r", state: "failed", failure: { message: "x" } };
// @ts-expect-error: not a job state
const badState: Job = { repo: "o/r", state: "done" };
void missingId;
void noCode;
void badState;

export const progress: JobEvent = {
  event: "progress",
  data: { jobId: "j", repo: "o/r", state: "parsing", progress: { stage: "parse", completed: 1, total: 4 } },
};

// Contract objects are read-only: a screen cannot change what it was given.
declare const session: Session;
// @ts-expect-error: readonly
session.signedIn = true;

