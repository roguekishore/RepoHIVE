"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "../components/button";
import { Kbd } from "../components/kbd";
import { Meter } from "../components/status";
import { SegmentedControl } from "../components/controls";
import { cx } from "../components/cx";
import type { Quota } from "../contracts";
import { Icon } from "../icons/icons";
import { Brand } from "../icons/mark";
import { SearchPalette, type PaletteGroup } from "../palette/search-palette";
import { useLink } from "../provider/design-provider";
import { parseRepoPath, routes } from "../routes";
import { useTheme, type ThemePreference } from "../theme/theme";
import { globalNav, repoNav } from "./nav";

export interface Crumb {
  readonly label: string;
  /** Absent on the last crumb, which is the current page. */
  readonly href?: string;
  /** A count or note after the label, in the quiet mono style. */
  readonly aside?: string;
  /** Makes the crumb a button that runs this instead of a link. Keep it stable: a crumb is compared by its text. */
  readonly onSelect?: () => void;
  /** Quiet text, such as the ellipsis that stands for crumbs left out. */
  readonly subtle?: boolean;
}

export interface AppFrameProps {
  /** The current path; it decides which navigation entry is current. */
  readonly pathname: string;
  readonly crumbs: readonly Crumb[];
  /** Controls at the trailing edge of the header, such as the index button. */
  readonly actions?: ReactNode;
  /** The signed-in state; a signed-out visitor sees a sign-in link where the usage meter would be. */
  readonly signedIn: boolean;
  readonly quota?: Quota;
  /** Lists Activity in the navigation. Leave off until the host serves a job list. */
  readonly showActivity?: boolean;
  /** Groups for the ⌘K palette. Keep the function stable between renders. */
  readonly paletteGroups: (query: string) => readonly PaletteGroup[];
  readonly paletteFootnote?: string;
  /** The status line at the foot of the main column; leave out for none. */
  readonly status?: ReactNode;
  /** The content fills the column and does not scroll (a canvas view). Otherwise it scrolls. */
  readonly fill?: boolean;
  readonly children: ReactNode;
}

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Auto" },
];

function UsageLine({ signedIn, quota }: { signedIn: boolean; quota: Quota | undefined }) {
  const Link = useLink();
  if (!signedIn) {
    return (
      <Link href={routes.signIn} className="rh-usage">
        <span className="rh-t-caption">Sign in to index a repository</span>
      </Link>
    );
  }
  if (quota === undefined) return null;
  const used = Math.max(0, quota.limitAccount - quota.remainingAccount);
  return (
    <Link href={routes.account} className="rh-usage">
      <span className="rh-t-caption">
        {used} of {quota.limitAccount} indexes today
      </span>
      <Meter value={used} max={quota.limitAccount} label="Indexes used today" />
    </Link>
  );
}

/**
 * The application frame: the sidebar (a sheet at 760px and below, and on a landscape screen under 480px tall), the 48px header with crumbs and actions, the content,
 * and an optional 28px status line. The ⌘K palette belongs to it, opened by the sidebar button and the shortcut.
 */
export function AppFrame({
  pathname,
  crumbs,
  actions,
  signedIn,
  quota,
  showActivity = false,
  paletteGroups,
  paletteFootnote,
  status,
  fill = false,
  children,
}: AppFrameProps) {
  const Link = useLink();
  const { preference, setPreference } = useTheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const repo = parseRepoPath(pathname);
  const global = globalNav(showActivity);

  const closeSheet = useCallback(() => setSheetOpen(false), []);
  useEffect(closeSheet, [pathname, closeSheet]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (event.key === "Escape") {
        setSheetOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const current = (href: string): "page" | undefined => (pathname === href ? "page" : undefined);

  return (
    <div className={cx("rh-app", sheetOpen && "rh-nav-open")}>
      <a className="rh-skip" href="#main-content">
        Skip to content
      </a>
      <aside className="rh-side" id="rh-side" aria-label="Main">
        <Link href={routes.repos} className="rh-side-brand" aria-label="RepoHIVE, repositories">
          <Brand />
        </Link>
        <button type="button" className="rh-side-search" onClick={() => setPaletteOpen(true)}>
          <Icon name="search" size={14} />
          Search
          <Kbd>⌘K</Kbd>
        </button>
        <nav className="rh-side-nav" aria-label="Global">
          {global.map((entry) => (
            <Link key={entry.id} href={entry.href} className="rh-nav-a" aria-current={current(entry.href)}>
              <Icon name={entry.icon} />
              {entry.label}
            </Link>
          ))}
        </nav>
        {repo === undefined ? null : (
          <div className="rh-side-repo-group">
            <div className="rh-side-sec rh-t-label">Repository</div>
            <div className="rh-side-repo">
              {repo.owner}/<wbr />
              {repo.name}
            </div>
            <nav className="rh-side-nav" aria-label={`${repo.owner}/${repo.name}`}>
              {repoNav(repo.owner, repo.name).map((entry) => {
                const on = repo.view === entry.view || (repo.view === undefined && entry.view === "overview");
                return (
                  <Link key={entry.id} href={entry.href} className="rh-nav-a" aria-current={on ? "page" : undefined}>
                    <Icon name={entry.icon} />
                    {entry.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
        <div className="rh-side-foot">
          <UsageLine signedIn={signedIn} quota={quota} />
          <SegmentedControl label="Theme" options={THEME_OPTIONS} value={preference} onChange={setPreference} />
          <nav className="rh-side-nav rh-side-nav-flush" aria-label="Account">
            <Link href={signedIn ? routes.account : routes.signIn} className="rh-nav-a" aria-current={current(routes.account)}>
              <Icon name="user" />
              {signedIn ? "Account" : "Sign in"}
            </Link>
          </nav>
        </div>
      </aside>
      {sheetOpen ? <div className="rh-sheet-scrim" onClick={closeSheet} aria-hidden="true" /> : null}

      <div className="rh-main">
        <header className="rh-topbar">
          <Button
            variant="ghost"
            icon
            className="rh-menu-btn"
            aria-label="Open navigation"
            aria-expanded={sheetOpen}
            aria-controls="rh-side"
            onClick={() => setSheetOpen((open) => !open)}
          >
            <Icon name="menu" />
          </Button>
          <nav className="rh-crumbs" aria-label="Location">
            {crumbs.map((crumb, position) => {
              const last = position === crumbs.length - 1;
              return (
                <span key={`${position}-${crumb.label}`} className="rh-crumb">
                  {position === 0 ? null : <span className="rh-crumb-sep">/</span>}
                  {crumb.onSelect !== undefined ? (
                    <button type="button" className={cx(last && "rh-cur")} aria-current={last ? "page" : undefined} onClick={crumb.onSelect}>
                      {crumb.label}
                    </button>
                  ) : crumb.href === undefined || last ? (
                    <span className={cx(last && "rh-cur", crumb.subtle && "rh-fg3")} aria-current={last ? "page" : undefined}>
                      {crumb.label}
                    </span>
                  ) : (
                    <Link href={crumb.href}>{crumb.label}</Link>
                  )}
                  {crumb.aside === undefined ? null : <span className="rh-fg3 rh-mono rh-num">{crumb.aside}</span>}
                </span>
              );
            })}
          </nav>
          {actions === undefined ? null : <div className="rh-top-actions">{actions}</div>}
        </header>
        <main id="main-content" tabIndex={-1} className={cx("rh-content", fill && "rh-fill")}>
          {children}
        </main>
        {status === undefined ? null : <footer className="rh-statusbar">{status}</footer>}
      </div>

      <SearchPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        groups={paletteGroups}
        placeholder="Search views, repositories, regions and files"
        footnote={paletteFootnote}
      />
    </div>
  );
}
