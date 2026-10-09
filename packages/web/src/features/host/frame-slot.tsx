"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { parseRepoPath, repoViewLabel, routes, type Crumb } from "@repohive/design";
import { OwnShell } from "./own-shell";

/** What a page tells the frame it sits in. Every field is optional: the frame has a default for each. */
export interface PageFrameSlot {
  readonly crumbs?: readonly Crumb[];
  readonly actions?: ReactNode;
  readonly status?: ReactNode;
  /** A canvas view fills the column instead of scrolling. */
  readonly fill?: boolean;
}

const SlotContext = createContext<((slot: PageFrameSlot) => void) | undefined>(undefined);

const GLOBAL_LABELS: Readonly<Record<string, string>> = {
  [routes.repos]: "Repositories",
  [routes.activity]: "Activity",
  [routes.method]: "Method",
  [routes.account]: "Account",
};

/**
 * The crumbs a path gets when its page sets none: the global page's name, or Repositories then the repository then
 * the view's label. A page with something more specific to say (a job's repository) sets its own through `PageFrame`.
 */
export function defaultCrumbs(pathname: string): readonly Crumb[] {
  const repo = parseRepoPath(pathname);
  if (repo !== undefined) {
    const name = `${repo.owner}/${repo.name}`;
    return [
      { label: "Repositories", href: routes.repos },
      repo.view === undefined ? { label: name } : { label: name, href: routes.repo(repo.owner, repo.name) },
      ...(repo.view === undefined ? [] : [{ label: repoViewLabel(repo.view) }]),
    ];
  }
  const label = GLOBAL_LABELS[pathname.replace(/\/$/, "")];
  return label === undefined ? [] : [{ label }];
}

/**
 * The framed group's frame (`OwnShell`), mounted once in the group's layout so it persists between pages. A page
 * renders `PageFrame` to set its crumbs, actions, status line or fill; without one it gets `defaultCrumbs`.
 */
export function OwnFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [slot, setSlot] = useState<PageFrameSlot>({});
  return (
    <SlotContext.Provider value={setSlot}>
      <OwnShell
        crumbs={slot.crumbs ?? defaultCrumbs(pathname)}
        actions={slot.actions}
        status={slot.status}
        fill={slot.fill}
      >
        {children}
      </OwnShell>
    </SlotContext.Provider>
  );
}

/** Sets the frame's slot for as long as the page is mounted; the frame returns to its defaults on unmount. */
export function PageFrame({ crumbs, actions, status, fill, children }: PageFrameSlot & { children?: ReactNode }) {
  const setSlot = useContext(SlotContext);
  const crumbKey = crumbs === undefined ? undefined : JSON.stringify(crumbs);
  useLayoutEffect(() => {
    if (setSlot === undefined) return;
    setSlot({ crumbs, actions, status, fill });
    return () => setSlot({});
    // `crumbs` is compared by value so a page that rebuilds its array each render does not re-set the slot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSlot, crumbKey, actions, status, fill]);
  return <>{children}</>;
}
