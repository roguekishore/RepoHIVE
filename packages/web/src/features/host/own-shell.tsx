"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AppFrame,
  useClient,
  type Crumb,
  type Quota,
  type RepositoryListItem,
  type Session,
} from "@repohive/design";
import { navigationGroups } from "./palette-groups";

export interface OwnShellProps {
  readonly crumbs: readonly Crumb[];
  readonly actions?: ReactNode;
  readonly status?: ReactNode;
  /** A canvas view fills the column instead of scrolling. */
  readonly fill?: boolean;
  readonly children: ReactNode;
}

/**
 * The app frame for the TS host. It loads what the frame itself shows (the session, the allowance, the repositories for
 * the palette) through the client, so a route shell passes only its crumbs and its screen. Activity stays out of the
 * navigation: TS serves no job list yet.
 */
export function OwnShell({ crumbs, actions, status, fill, children }: OwnShellProps) {
  const pathname = usePathname();
  const client = useClient();
  const [session, setSession] = useState<Session | undefined>(undefined);
  const [quota, setQuota] = useState<Quota | undefined>(undefined);
  const [repositories, setRepositories] = useState<readonly RepositoryListItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    void client.session().then((next) => {
      if (cancelled) return;
      setSession(next);
      if (!next.signedIn) {
        setQuota(undefined);
        return;
      }
      client
        .quota()
        .then((loaded) => {
          if (!cancelled) setQuota(loaded);
        })
        .catch(() => {
          // The meter is a convenience; the frame renders without it.
        });
    });
    return () => {
      cancelled = true;
    };
    // The allowance changes after an index request, so each navigation re-reads it.
  }, [client, pathname]);

  useEffect(() => {
    let cancelled = false;
    client
      .listRepositories()
      .then((page) => {
        if (!cancelled) setRepositories(page.items);
      })
      .catch(() => {
        // The palette still lists pages and views.
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const paletteGroups = useCallback(
    (query: string) => navigationGroups(pathname, repositories, query),
    [pathname, repositories],
  );

  return (
    <AppFrame
      pathname={pathname}
      crumbs={crumbs}
      actions={actions}
      status={status}
      fill={fill}
      signedIn={session?.signedIn === true}
      quota={quota}
      paletteGroups={paletteGroups}
    >
      {children}
    </AppFrame>
  );
}
