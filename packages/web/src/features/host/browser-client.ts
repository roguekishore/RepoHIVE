/**
 * The TS host's translation layer for the browser: one `ContractClient` that maps this server's real endpoints
 * (`/api/*`, `/r/*`, `/s/*`) onto the shapes `@repohive/design` screens receive. A screen never sees a URL.
 *
 * `fetch`, the origin header and `EventSource` are injected so the tests can drive it without a browser; the defaults
 * are the browser's. A read that finds nothing answers `undefined` (a 404); a network failure or an unreadable body
 * rejects; an action answers an `ActionResult` for any answer the server gave.
 */
import {
  JOB_STATES,
  type ActionResult,
  type ApiError,
  type ArchitectureLevelView,
  type ContractClient,
  type Credentials,
  type IndexRequestResult,
  type Job,
  type JobEvent,
  type JobEventData,
  type JobProgress,
  type JobState,
  type Quota,
  type RegionDetailIndex,
  type RegionDetailView,
  type RepositoryListItem,
  type RepositoryPage,
  type RepositorySummary,
  type Session,
  type SnapshotManifest,
  type SnapshotPointer,
  type ViewBodies,
  type ViewName,
} from "@repohive/design/contracts";
import { clientSiteOrigin } from "@/lib/site-origin";
import { latestPointerPath, parseSnapshotParam } from "@/features/repository/repo-name";

/** Where a snapshot publishes each view, relative to `/s/<snapshotId>/`. Pinned to the indexer's layout by a test. */
export const VIEW_PATHS: Readonly<Record<ViewName, string>> = {
  repo: "views/repo.json",
  graph: "views/graph.json",
  adaptivity: "views/adaptivity.json",
  hierarchyScale: "views/hierarchy-scale.json",
  regionDecisions: "views/region-decisions.json",
  zoomMap: "views/zoom-map.json",
  architecture: "views/architecture.json",
  blastRadius: "views/blast-radius.json",
};

export const REGION_DETAIL_INDEX_PATH = "views/region-detail-index.json";
export const architectureLevelPath = (position: number): string => `views/architecture/${position}.json`;
export const regionDetailPath = (position: number): string => `views/region-detail/${position}.json`;

const DEFAULT_BUSY_RETRY_SECONDS = 120;
const UNPUBLISHED = "This part of the snapshot is not published.";

export interface BrowserClientOptions {
  readonly fetch?: typeof fetch;
  /** The `Origin` sent with state-changing requests. Defaults to the page's origin. */
  readonly origin?: () => string;
  readonly openEventSource?: (url: string) => EventSource;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function apiError(body: unknown): ApiError {
  const record = isRecord(body) ? body : {};
  return {
    code: str(record.code) ?? "REQUEST_FAILED",
    message: str(record.message) ?? "The request failed.",
  };
}

function toProgress(value: unknown): JobProgress | undefined {
  if (!isRecord(value)) return undefined;
  const stage = str(value.stage);
  if (stage === undefined) return undefined;
  const completed = num(value.completed);
  const total = num(value.total);
  return {
    stage,
    ...(completed === undefined ? {} : { completed }),
    ...(total === undefined ? {} : { total }),
  };
}

function isJobState(value: unknown): value is JobState {
  return typeof value === "string" && (JOB_STATES as readonly string[]).includes(value);
}

/**
 * TS reports a failed job with `message` equal to the code (it keeps no wording). A code is not a sentence to show,
 * so `message` is passed on only when it says something else.
 */
function toJobBody(body: Json, fallbackRepo: string): Job | undefined {
  if (!isJobState(body.state)) return undefined;
  const progress = toProgress(body.progress);
  const result = isRecord(body.result) && str(body.result.snapshotId) !== undefined ? body.result : undefined;
  const failure = isRecord(body.failure) && str(body.failure.code) !== undefined ? body.failure : undefined;
  const failureCode = failure === undefined ? undefined : (str(failure.code) as string);
  const failureMessage = failure === undefined ? undefined : str(failure.message);
  return {
    repo: str(body.repo) ?? fallbackRepo,
    state: body.state,
    ...(progress === undefined ? {} : { progress }),
    ...(result === undefined ? {} : { result: { snapshotId: str(result.snapshotId) as string } }),
    ...(failureCode === undefined
      ? {}
      : {
          failure: {
            code: failureCode,
            ...(failureMessage === undefined || failureMessage === failureCode ? {} : { message: failureMessage }),
          },
        }),
  };
}

function toEventData(fallbackJobId: string, raw: unknown): JobEventData | undefined {
  let body: unknown;
  try {
    body = typeof raw === "string" ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
  if (!isRecord(body)) return undefined;
  // A `done` frame for an unknown job carries no repository.
  const job = toJobBody(body, "");
  if (job === undefined) return undefined;
  return { jobId: str(body.jobId) ?? fallbackJobId, ...job };
}

function toListItem(value: unknown): RepositoryListItem | undefined {
  if (!isRecord(value)) return undefined;
  const repoKey = str(value.repoKey);
  const repoId = str(value.repoId);
  const snapshotId = str(value.snapshotId);
  const commitSha = str(value.commitSha);
  const indexedAt = str(value.indexedAt);
  const nodeCount = num(value.nodeCount);
  if (
    repoKey === undefined ||
    repoId === undefined ||
    snapshotId === undefined ||
    commitSha === undefined ||
    indexedAt === undefined ||
    nodeCount === undefined
  ) {
    return undefined;
  }
  return { repoKey, repoId, snapshotId, commitSha, indexedAt, nodeCount };
}

function toPage(body: unknown): RepositoryPage {
  if (isRecord(body) && Array.isArray(body.items)) {
    const items = body.items.map(toListItem);
    const page = num(body.page);
    const totalPages = num(body.totalPages);
    const total = num(body.total);
    if (
      page !== undefined &&
      totalPages !== undefined &&
      total !== undefined &&
      items.every((item): item is RepositoryListItem => item !== undefined)
    ) {
      return { items, page, totalPages, total };
    }
  }
  throw new Error("The repository list is not understood.");
}

function toSummary(body: unknown): RepositorySummary {
  if (isRecord(body)) {
    const repo = str(body.repo);
    const snapshotId = str(body.snapshotId);
    const commitSha = str(body.commitSha);
    const nodeCount = num(body.nodeCount);
    const indexedAt = str(body.indexedAt);
    const edgeCount = num(body.edgeCount);
    if (
      repo !== undefined &&
      snapshotId !== undefined &&
      commitSha !== undefined &&
      nodeCount !== undefined &&
      indexedAt !== undefined
    ) {
      return { repo, snapshotId, commitSha, nodeCount, indexedAt, ...(edgeCount === undefined ? {} : { edgeCount }) };
    }
  }
  throw new Error("The repository is not understood.");
}

function toQuota(body: unknown): Quota {
  if (isRecord(body)) {
    const remainingAccount = num(body.remainingAccount);
    const remainingIp = num(body.remainingIp);
    const limitAccount = num(body.limitAccount);
    const limitIp = num(body.limitIp);
    if (
      remainingAccount !== undefined &&
      remainingIp !== undefined &&
      limitAccount !== undefined &&
      limitIp !== undefined
    ) {
      return { remainingAccount, remainingIp, limitAccount, limitIp };
    }
  }
  throw new Error("The quota is not understood.");
}

function toPointer(body: unknown): SnapshotPointer {
  const snapshotId = isRecord(body) ? parseSnapshotParam(str(body.snapshotId)) : undefined;
  if (!isRecord(body) || snapshotId === undefined) {
    throw new Error("The latest snapshot pointer is malformed.");
  }
  const commitSha = str(body.commitSha);
  const engineVersion = str(body.engineVersion);
  const viewsVersion = str(body.viewsVersion);
  const publishedAt = str(body.publishedAt);
  return {
    snapshotId,
    ...(commitSha === undefined ? {} : { commitSha }),
    ...(engineVersion === undefined ? {} : { engineVersion }),
    ...(viewsVersion === undefined ? {} : { viewsVersion }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  };
}

function toIndexResult(response: Response, body: unknown): IndexRequestResult {
  const record = isRecord(body) ? body : {};
  if (response.status !== 401) {
    switch (record.status) {
      case "cached": {
        const repo = str(record.repo);
        const snapshotId = str(record.snapshotId);
        if (repo !== undefined && snapshotId !== undefined) return { status: "cached", repo, snapshotId };
        break;
      }
      case "joined":
      case "accepted": {
        const jobId = str(record.jobId);
        if (jobId !== undefined) return { status: record.status, jobId };
        break;
      }
      case "busy": {
        const fromHeader = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
        const retryAfterSeconds =
          num(record.retryAfterSeconds) ?? (Number.isFinite(fromHeader) ? fromHeader : DEFAULT_BUSY_RETRY_SECONDS);
        return { status: "busy", retryAfterSeconds };
      }
      case "rejected": {
        const error = apiError(record);
        return { status: "rejected", code: error.code, message: error.message };
      }
    }
  }
  const error = apiError(record);
  return { status: "rejected", code: error.code, message: error.message };
}

export function createBrowserClient(options: BrowserClientOptions = {}): ContractClient {
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const origin = options.origin ?? clientSiteOrigin;
  const openEventSource = options.openEventSource ?? ((url: string) => new EventSource(url));

  async function postJson(path: string, body?: unknown): Promise<Response> {
    return doFetch(path, {
      method: "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        Origin: origin(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function action(path: string, body?: unknown): Promise<ActionResult> {
    const response = await postJson(path, body);
    if (response.ok) return { ok: true };
    return { ok: false, error: apiError(await readJson(response)) };
  }

  /** A body, or `undefined` for a 404. Anything else that is not a success rejects. */
  async function getOptional(path: string): Promise<unknown | undefined> {
    const response = await doFetch(path);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Request failed (${response.status}).`);
    return response.json();
  }

  async function getRequired<T>(path: string): Promise<T> {
    const body = await getOptional(path);
    if (body === undefined) throw new Error(UNPUBLISHED);
    return body as T;
  }

  function snapshotPath(snapshotId: string, path: string): string {
    if (parseSnapshotParam(snapshotId) === undefined) throw new Error("Not a snapshot id.");
    return `/s/${snapshotId}/${path}`;
  }

  function position(n: number): number {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Not a 0-based position: ${n}`);
    return n;
  }

  return {
    async session(): Promise<Session> {
      try {
        const response = await doFetch("/api/auth/session");
        if (!response.ok) return { signedIn: false };
        const body = await readJson(response);
        if (isRecord(body) && body.signedIn === true) {
          const email = str(body.email);
          return { signedIn: true, ...(email === undefined ? {} : { email }) };
        }
        return { signedIn: false };
      } catch {
        // A session probe that cannot reach the server reads as signed out, as it always has.
        return { signedIn: false };
      }
    },
    signIn: (credentials: Credentials) => action("/api/auth/sign-in", credentials),
    signUp: (credentials: Credentials) => action("/api/auth/sign-up", credentials),
    signOut: () => action("/api/auth/sign-out"),

    async quota(): Promise<Quota | undefined> {
      const response = await doFetch("/api/quota");
      if (response.status === 401) return undefined;
      if (!response.ok) throw new Error(apiError(await readJson(response)).message);
      return toQuota(await readJson(response));
    },

    async requestIndex(repo: string): Promise<IndexRequestResult> {
      const response = await postJson("/api/index", { repo });
      return toIndexResult(response, await readJson(response));
    },

    async job(jobId: string): Promise<Job | undefined> {
      const body = await getOptional(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (body === undefined) return undefined;
      const job = isRecord(body) ? toJobBody(body, "") : undefined;
      if (job === undefined) throw new Error("The job is not understood.");
      return job;
    },

    watchJob(jobId, onEvent, onError): () => void {
      const source = openEventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
      let ended = false;
      const end = (): void => {
        ended = true;
        source.close();
      };
      const deliver =
        (kind: JobEvent["event"]) =>
        (message: Event): void => {
          if (ended) return;
          const data = toEventData(jobId, (message as MessageEvent).data);
          // A malformed frame is skipped, as the job page always did.
          if (data === undefined) return;
          onEvent({ event: kind, data });
          if (kind === "done") end();
        };
      source.addEventListener("progress", deliver("progress"));
      source.addEventListener("done", deliver("done"));
      source.onerror = () => {
        if (ended) return;
        end();
        onError(new Error("The progress stream was interrupted."));
      };
      return end;
    },

    async listRepositories(page?: number): Promise<RepositoryPage> {
      const query = page === undefined ? "" : `?page=${encodeURIComponent(String(page))}`;
      return toPage(await getRequired<unknown>(`/api/repos${query}`));
    },

    async repository(owner: string, name: string): Promise<RepositorySummary | undefined> {
      const body = await getOptional(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
      return body === undefined ? undefined : toSummary(body);
    },

    async snapshotPointer(owner: string, name: string): Promise<SnapshotPointer | undefined> {
      const body = await getOptional(latestPointerPath(`${encodeURIComponent(owner)}/${encodeURIComponent(name)}`));
      return body === undefined ? undefined : toPointer(body);
    },

    async manifest(snapshotId: string): Promise<SnapshotManifest | undefined> {
      const body = await getOptional(snapshotPath(snapshotId, "manifest.json"));
      if (body === undefined) return undefined;
      if (!isRecord(body) || !Array.isArray(body.files)) throw new Error("The snapshot manifest is malformed.");
      return body as unknown as SnapshotManifest;
    },

    async view<K extends ViewName>(snapshotId: string, name: K): Promise<ViewBodies[K]> {
      return getRequired<ViewBodies[K]>(snapshotPath(snapshotId, VIEW_PATHS[name]));
    },
    async architectureLevel(snapshotId: string, n: number): Promise<ArchitectureLevelView> {
      return getRequired<ArchitectureLevelView>(snapshotPath(snapshotId, architectureLevelPath(position(n))));
    },
    async regionDetailIndex(snapshotId: string): Promise<RegionDetailIndex> {
      return getRequired<RegionDetailIndex>(snapshotPath(snapshotId, REGION_DETAIL_INDEX_PATH));
    },
    async regionDetail(snapshotId: string, n: number): Promise<RegionDetailView> {
      return getRequired<RegionDetailView>(snapshotPath(snapshotId, regionDetailPath(position(n))));
    },
  };
}
