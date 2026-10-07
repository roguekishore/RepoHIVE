"use client";

import { Button, LinkButton } from "../../components/button";
import { Page, Text } from "../../components/feedback";
import { routes } from "../../routes";

export interface NotFoundScreenProps {
  /** Where "Home" goes: the landing page from outside the app, the dashboard from inside it. */
  readonly home?: "landing" | "repos";
}

/** "There is no page here": an unknown URL, or a job or repository that was removed. */
export function NotFoundScreen({ home = "landing" }: NotFoundScreenProps) {
  return (
    <Page narrow>
      <div className="rh-empty rh-status-page">
        <Text role="label">404</Text>
        <h1 className="rh-t-title">There is no page here.</h1>
        <p className="rh-fg2">The link may be old, or the job or repository may have been removed.</p>
        <div className="rh-status-actions">
          <LinkButton href={home === "landing" ? routes.landing : routes.repos}>{home === "landing" ? "Home page" : "Home"}</LinkButton>
          {home === "landing" ? <LinkButton variant="primary" href={routes.repos}>Repositories</LinkButton> : null}
        </div>
      </div>
    </Page>
  );
}

export interface ErrorScreenProps {
  readonly error: { readonly message?: string; readonly digest?: string };
  /** Tries the page again (Next's `reset`). */
  readonly reset: () => void;
  readonly home?: "landing" | "repos";
}

/** "Something went wrong": what the page threw, the digest when there is one, and the way back. */
export function ErrorScreen({ error, reset, home = "repos" }: ErrorScreenProps) {
  return (
    <Page narrow>
      <div className="rh-empty rh-status-page" role="alert">
        <Text role="label">Error</Text>
        <h1 className="rh-t-title">Something went wrong.</h1>
        <p className="rh-fg2">{error.message === undefined || error.message === "" ? "An unexpected error occurred. Try again." : error.message}</p>
        {error.digest === undefined ? null : (
          <p className="rh-t-caption rh-fg3">
            Reference <span className="rh-mono">{error.digest}</span>
          </p>
        )}
        <div className="rh-status-actions">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <LinkButton href={home === "landing" ? routes.landing : routes.repos}>{home === "landing" ? "Home page" : "Repositories"}</LinkButton>
        </div>
      </div>
    </Page>
  );
}

/** What a page shows while its route loads. Announced politely, so a screen reader hears it once. */
export function LoadingScreen({ what = "the page" }: { readonly what?: string }) {
  return (
    <Page>
      <p className="rh-fg3 rh-v-loading" role="status">
        Loading {what}…
      </p>
    </Page>
  );
}
