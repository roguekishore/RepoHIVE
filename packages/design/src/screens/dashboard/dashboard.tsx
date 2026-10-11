"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/button";
import { Chip, Select } from "../../components/controls";
import { cx } from "../../components/cx";
import { Field } from "../../components/field";
import { Alert, EmptyState, Page } from "../../components/feedback";
import { SplitBar, StatusDot, type StatusTone } from "../../components/status";
import { SIZE_TIERS, type JobList, type RepositoryListItem, type SizeTier } from "../../contracts";
import { Icon } from "../../icons/icons";
import { useLink } from "../../provider/design-provider";
import {
  NO_FILTER,
  buildCards,
  filterCards,
  paginate,
  sortCards,
  type CardFilter,
  type CardSort,
  type RepoCardModel,
} from "./cards";
import { keptPercent, type RepoFigures } from "./figures";
import { describeFailureCode, formatCount, formatDay } from "./format";
import type { DashboardFrame } from "./frame-prop";
import { IndexRequestDialog } from "./index-dialog";
import { RepoPrint } from "./repo-print";
import { useRepoFigures } from "./use-figures";

export interface DashboardProps {
  /** The host's frame slot (see {@link DashboardFrame}). */
  readonly Frame: DashboardFrame;
  /** Every indexed repository; `undefined` while they load. */
  readonly repositories?: readonly RepositoryListItem[];
  /** The signed-in account's jobs; `undefined` when signed out or not loaded. They add running and failed status. */
  readonly jobs?: JobList;
  /** Why the list could not be read. */
  readonly error?: string;
  /** The clock the "today" and "yesterday" wording reads; a test fixes it. */
  readonly now?: Date;
}

const SORT_OPTIONS: readonly { readonly value: CardSort; readonly label: string }[] = [
  { value: "recent", label: "Recently indexed" },
  { value: "name", label: "Name" },
  { value: "files", label: "Most files" },
  { value: "rebuilt", label: "Most rebuilt" },
];

/** Nothing recorded yet: which cards a list shows must not depend on figures that have not been read. */
const NO_FIGURES = (): undefined => undefined;

const TONE: Readonly<Record<RepoCardModel["status"], StatusTone>> = { ok: "ok", run: "run", err: "err" };

function statusText(card: RepoCardModel, now: Date): string {
  const job = card.job;
  if (card.status === "run" && job !== undefined) {
    const { completed, total } = job.progress ?? {};
    return completed !== undefined && total !== undefined && total > 0 ? `Indexing · ${Math.round((completed / total) * 100)}%` : "Indexing";
  }
  if (card.status === "err" && job !== undefined) return describeFailureCode(job.failure?.code ?? "failed");
  return (card.indexed === undefined ? undefined : formatDay(card.indexed.indexedAt, now)) ?? "Indexed";
}

function Stats({ card, figures }: { card: RepoCardModel; figures: RepoFigures | undefined }) {
  if (figures !== undefined) {
    const kept = keptPercent(figures);
    return (
      <>
        <span>
          <b>{formatCount(figures.files)}</b> files
        </span>
        <span>
          <b>{formatCount(figures.regions)}</b> regions
        </span>
        {kept === undefined ? null : (
          <span title={`Of the ${formatCount(figures.assessed)} regions the engine assessed`}>
            <b>{kept}%</b> kept
          </span>
        )}
      </>
    );
  }
  if (card.indexed !== undefined) {
    return card.indexed.nodeCount > 0 ? (
      <span>
        <b>{formatCount(card.indexed.nodeCount)}</b> nodes
      </span>
    ) : null;
  }
  return card.job === undefined ? null : (
    <span>
      Size <b>{card.job.tier}</b>
    </span>
  );
}

function CardBar({ card, figures }: { card: RepoCardModel; figures: RepoFigures | undefined }) {
  const progress = card.job?.progress;
  if (card.status === "run" && progress?.completed !== undefined && progress.total !== undefined && progress.total > 0) {
    const fraction = Math.min(1, progress.completed / progress.total);
    return (
      <div
        className="rh-bar rh-rc-bar"
        role="progressbar"
        aria-label="Indexing progress"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.completed}
      >
        <i className="rh-bar-progress" style={{ width: `${fraction * 100}%` }} />
      </div>
    );
  }
  if (figures !== undefined && figures.assessed > 0) {
    return (
      <SplitBar
        className="rh-rc-bar"
        label={`${formatCount(figures.preserved)} of ${formatCount(figures.assessed)} assessed regions kept, ${formatCount(figures.reconstructed)} rebuilt`}
        segments={[
          { kind: "kept", value: figures.preserved },
          { kind: "rebuilt", value: figures.reconstructed },
        ]}
      />
    );
  }
  return <div className="rh-bar rh-rc-bar" aria-hidden="true" />;
}

function RepoCard({ card, figures, now }: { card: RepoCardModel; figures: RepoFigures | undefined; now: Date }) {
  const Link = useLink();
  // A card with nothing indexed behind it and a failed job reads as set aside.
  const dim = card.status === "err" && card.indexed === undefined;
  return (
    <li className={cx("rh-rcard", dim && "rh-is-failed")}>
      <div className="rh-rc-top">
        <div className="rh-rc-title">
          <span className="rh-fg3">{card.owner} /</span>
          <Link className="rh-rc-name rh-t-heading" href={card.href}>
            {card.name}
          </Link>
        </div>
        {figures !== undefined && figures.assessed > 0 ? (
          <RepoPrint seed={card.repoId} preserved={figures.preserved} reconstructed={figures.reconstructed} />
        ) : null}
      </div>
      <div className="rh-rc-stats rh-t-caption">
        <Stats card={card} figures={figures} />
        <span className="rh-tag rh-rc-status">
          <StatusDot tone={TONE[card.status]} />
          <span className="rh-fg3">{statusText(card, now)}</span>
        </span>
      </div>
      <CardBar card={card} figures={figures} />
    </li>
  );
}

/**
 * The dashboard: one card per indexed repository, with a filter, size chips, a "needs attention" toggle and a sort.
 * What a card shows beyond the list's own fields comes from the snapshot's recorded figures and, when signed in, the
 * account's jobs; a field nothing recorded is not shown.
 */
export function Dashboard({ Frame, repositories, jobs, error, now: nowProp }: DashboardProps) {
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);
  const [filter, setFilter] = useState<CardFilter>(NO_FILTER);
  const [sort, setSort] = useState<CardSort>("recent");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const listTop = useRef<HTMLDivElement>(null);

  // A new filter or sort starts again from the first page.
  const changeFilter = (update: (previous: CardFilter) => CardFilter): void => {
    setFilter(update);
    setPage(1);
  };

  const cards = useMemo(() => buildCards(repositories ?? [], jobs), [repositories, jobs]);
  // Sorting by files or rebuilt share, and the size chips, need every card's figures. Otherwise which cards show does
  // not depend on them, so only the visible page's snapshots are read.
  const needsAllFigures = sort === "files" || sort === "rebuilt" || filter.sizes.length > 0;
  const preview = useMemo(() => sortCards(filterCards(cards, filter, NO_FIGURES), sort, NO_FIGURES), [cards, filter, sort]);
  const snapshotIds = useMemo(
    () => (needsAllFigures ? cards : paginate(preview, page).items).flatMap((card) => (card.indexed === undefined ? [] : [card.indexed.snapshotId])),
    [needsAllFigures, cards, preview, page],
  );
  const figuresById = useRepoFigures(snapshotIds);
  const figuresOf = useMemo(
    () =>
      (card: RepoCardModel): RepoFigures | undefined =>
        card.indexed === undefined ? undefined : (figuresById.get(card.indexed.snapshotId) ?? undefined),
    [figuresById],
  );

  const shown = useMemo(() => sortCards(filterCards(cards, filter, figuresOf), sort, figuresOf), [cards, filter, sort, figuresOf]);
  const paged = useMemo(() => paginate(shown, page), [shown, page]);
  const goToPage = (next: number): void => {
    setPage(next);
    listTop.current?.scrollIntoView?.({ block: "start" });
  };
  const filtering = filter.query.trim() !== "" || filter.sizes.length > 0 || filter.attention;

  // "/" jumps to the filter unless a field already has the keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const active = document.activeElement;
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
      if (active !== null && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return;
      event.preventDefault();
      search.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const toggleSize = (size: SizeTier): void =>
    changeFilter((previous) => ({
      ...previous,
      sizes: previous.sizes.includes(size) ? previous.sizes.filter((entry) => entry !== size) : [...previous.sizes, size],
    }));

  const count = shown.length === cards.length ? String(cards.length) : `${shown.length} of ${cards.length}`;
  const loaded = repositories !== undefined;
  const actions = useMemo(
    () => (
      <Button variant="primary" onClick={() => setDialog(true)}>
        <Icon name="plus" size={14} />
        <span className="rh-hide-sm">Index a repository</span>
      </Button>
    ),
    [],
  );

  let body;
  if (error !== undefined) {
    body = <Alert title="The repositories could not be loaded">{error}</Alert>;
  } else if (repositories === undefined) {
    body = (
      <p className="rh-t-caption rh-fg3" role="status">
        Loading repositories
      </p>
    );
  } else if (cards.length === 0) {
    body = (
      <EmptyState
        title="No repositories yet"
        action={
          <Button onClick={() => setDialog(true)}>
            <Icon name="plus" size={14} />
            Index a repository
          </Button>
        }
      >
        Index a public Java repository and it appears here.
      </EmptyState>
    );
  } else {
    body = (
      <>
        <div className="rh-dash-tools" ref={listTop}>
          <Field
            ref={search}
            className="rh-dash-search"
            icon="search"
            hint="/"
            placeholder="Filter by owner or name"
            aria-label="Filter by owner or name"
            autoComplete="off"
            value={filter.query}
            onChange={(event) => changeFilter((previous) => ({ ...previous, query: event.target.value }))}
          />
          <span className="rh-vr" aria-hidden="true" />
          <div className="rh-dash-tools" role="group" aria-label="Size">
            {SIZE_TIERS.map((size) => (
              <Chip key={size} pressed={filter.sizes.includes(size)} onClick={() => toggleSize(size)}>
                {size}
              </Chip>
            ))}
          </div>
          <span className="rh-vr" aria-hidden="true" />
          <Chip pressed={filter.attention} onClick={() => changeFilter((previous) => ({ ...previous, attention: !previous.attention }))}>
            <StatusDot tone="warn" />
            Needs attention
          </Chip>
          <Select className="rh-dash-sort" aria-label="Sort" value={sort} onChange={(event) => {
              setSort(event.target.value as CardSort);
              setPage(1);
            }}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <ul className="rh-cards">
          {shown.length === 0 ? (
            <li className="rh-empty">
              <span>No repositories match.</span>
              <Button size="sm" onClick={() => changeFilter(() => NO_FILTER)} disabled={!filtering}>
                Clear filters
              </Button>
            </li>
          ) : (
            paged.items.map((card) => <RepoCard key={card.repoId} card={card} figures={figuresOf(card)} now={now} />)
          )}
        </ul>
        {paged.pageCount > 1 ? (
          <nav className="rh-pager" aria-label="Repository pages">
            <Button size="sm" onClick={() => goToPage(paged.page - 1)} disabled={paged.page <= 1}>
              Previous
            </Button>
            <span className="rh-t-caption rh-fg3" aria-live="polite">
              Page {paged.page} of {paged.pageCount}
            </span>
            <Button size="sm" onClick={() => goToPage(paged.page + 1)} disabled={paged.page >= paged.pageCount}>
              Next
            </Button>
          </nav>
        ) : null}
      </>
    );
  }

  return (
    <Frame crumbs={[{ label: "Repositories", aside: loaded ? count : undefined }]} actions={actions}>
      <Page>{body}</Page>
      <IndexRequestDialog open={dialog} onClose={() => setDialog(false)} />
    </Frame>
  );
}
