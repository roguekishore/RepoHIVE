/**
 * The dashboard's cards as plain data: the indexed repositories, each with the account's latest job for it, plus a card
 * for a repository the account has a job for that is not indexed yet (running) or never got indexed (failed). Pure, so
 * the rules are tested without a screen.
 */
import { isTerminalJobState, type JobList, type JobListItem, type RepositoryListItem, type SizeTier } from "../../contracts";
import { routes } from "../../routes";
import { repoIdFromJobRepo } from "./format";
import { sizeClassForFiles, type RepoFigures } from "./figures";

export type CardStatus = "ok" | "run" | "err";

export interface RepoCardModel {
  /** `owner/name`, lowercase: what the list and the jobs agree on. */
  readonly repoId: string;
  readonly owner: string;
  readonly name: string;
  /** Absent for a repository that has no published snapshot. */
  readonly indexed?: Pick<RepositoryListItem, "snapshotId" | "commitSha" | "indexedAt" | "nodeCount">;
  /** The account's newest job for this repository; absent when signed out or when it has none. */
  readonly job?: JobListItem;
  readonly status: CardStatus;
  /** Where the card opens: the repository, or its job while one runs or when there is nothing to open. */
  readonly href: string;
  /** The instant the card sorts by under "recent". */
  readonly time: string;
}

function split(repoId: string): { owner: string; name: string } {
  const slash = repoId.indexOf("/");
  return slash === -1 ? { owner: "", name: repoId } : { owner: repoId.slice(0, slash), name: repoId.slice(slash + 1) };
}

function statusOf(job: JobListItem | undefined): CardStatus {
  if (job === undefined) return "ok";
  if (!isTerminalJobState(job.state)) return "run";
  return job.state === "failed" ? "err" : "ok";
}

export function buildCards(repositories: readonly RepositoryListItem[], jobs: JobList | undefined): RepoCardModel[] {
  // `jobs.items` is newest first, so the first job seen for a repository is its latest.
  const latest = new Map<string, JobListItem>();
  for (const job of jobs?.items ?? []) {
    const id = repoIdFromJobRepo(job.repo);
    if (!latest.has(id)) latest.set(id, job);
  }

  const seen = new Set<string>();
  const cards: RepoCardModel[] = [];
  for (const item of repositories) {
    const repoId = item.repoId.toLowerCase();
    if (seen.has(repoId)) continue;
    seen.add(repoId);
    const job = latest.get(repoId);
    const status = statusOf(job);
    const { owner, name } = split(item.repoId);
    cards.push({
      repoId,
      owner,
      name,
      indexed: { snapshotId: item.snapshotId, commitSha: item.commitSha, indexedAt: item.indexedAt, nodeCount: item.nodeCount },
      ...(job === undefined ? {} : { job }),
      status,
      href: status === "run" && job !== undefined ? routes.job(job.jobId) : routes.repo(owner, name),
      time: item.indexedAt,
    });
  }

  for (const [repoId, job] of latest) {
    if (seen.has(repoId)) continue;
    const status = statusOf(job);
    // A repository whose only recorded job succeeded is indexed, so the list holds it; nothing to add.
    if (status === "ok") continue;
    const { owner, name } = split(repoId);
    cards.push({ repoId, owner, name, job, status, href: routes.job(job.jobId), time: job.requestedAt });
  }
  return cards;
}

/** The card's size class: the recorded file count's class, else the tier the account's job was admitted under. */
export function cardSize(card: RepoCardModel, figures: RepoFigures | undefined): SizeTier | undefined {
  if (figures !== undefined) return sizeClassForFiles(figures.files);
  return card.indexed === undefined ? card.job?.tier : undefined;
}

export type CardSort = "recent" | "name" | "files" | "rebuilt";

export interface CardFilter {
  readonly query: string;
  readonly sizes: readonly SizeTier[];
  readonly attention: boolean;
}

export const NO_FILTER: CardFilter = { query: "", sizes: [], attention: false };

export function filterCards(
  cards: readonly RepoCardModel[],
  filter: CardFilter,
  figures: (card: RepoCardModel) => RepoFigures | undefined,
): RepoCardModel[] {
  const term = filter.query.trim().toLowerCase();
  return cards.filter((card) => {
    if (term !== "" && !card.repoId.includes(term)) return false;
    if (filter.sizes.length > 0) {
      const size = cardSize(card, figures(card));
      if (size === undefined || !filter.sizes.includes(size)) return false;
    }
    if (filter.attention && card.status !== "err") return false;
    return true;
  });
}

/** Stable and total: every order ends on the repository id, so identical input gives the identical list. */
export function sortCards(
  cards: readonly RepoCardModel[],
  sort: CardSort,
  figures: (card: RepoCardModel) => RepoFigures | undefined,
): RepoCardModel[] {
  const byId = (a: RepoCardModel, b: RepoCardModel): number => (a.repoId < b.repoId ? -1 : a.repoId > b.repoId ? 1 : 0);
  const rebuiltShare = (card: RepoCardModel): number => {
    const share = figures(card)?.preserveShare;
    return share === null || share === undefined ? -1 : 1 - share;
  };
  const filesOf = (card: RepoCardModel): number => figures(card)?.files ?? -1;
  return [...cards].sort((a, b) => {
    if (sort === "name") return byId(a, b);
    if (sort === "files") return filesOf(b) - filesOf(a) || byId(a, b);
    if (sort === "rebuilt") return rebuiltShare(b) - rebuiltShare(a) || byId(a, b);
    // Recently indexed: what is running first (it is the newest thing), then the newest instant.
    if ((a.status === "run") !== (b.status === "run")) return a.status === "run" ? -1 : 1;
    return a.time === b.time ? byId(a, b) : a.time < b.time ? 1 : -1;
  });
}

/** Cards drawn at once. A thousand cards, each reading its own snapshot, made the page lag. */
export const DASHBOARD_PAGE_SIZE = 24;

export interface CardPage<T> {
  /** The page shown, 1 based and clamped into `1..pageCount`. */
  readonly page: number;
  readonly pageCount: number;
  readonly items: readonly T[];
}

/** One page of a list; a page past the end shows the last one, and an empty list is one empty page. */
export function paginate<T>(items: readonly T[], page: number, size: number = DASHBOARD_PAGE_SIZE): CardPage<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)), pageCount);
  return { page: current, pageCount, items: items.slice((current - 1) * size, current * size) };
}
