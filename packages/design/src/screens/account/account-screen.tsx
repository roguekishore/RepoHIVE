"use client";

import { useEffect, useState } from "react";
import { Alert, EmptyState, Page, Text } from "../../components/feedback";
import { Button, LinkButton } from "../../components/button";
import { KeyValueList, Panel } from "../../components/panel";
import { Meter } from "../../components/status";
import type { Quota } from "../../contracts";
import { useClient, useNavigate } from "../../provider/design-provider";
import { useToast } from "../../provider/toast";
import { routes } from "../../routes";

/** What the Account page is showing. The shell reads it with {@link useAccountState} and hands it to the screen. */
export type AccountState =
  | { readonly status: "loading" }
  | { readonly status: "signed-out" }
  | { readonly status: "failed" }
  /** `quota` is absent when the allowance could not be read; the page says so rather than guessing. */
  | { readonly status: "ready"; readonly email: string | undefined; readonly quota: Quota | undefined };

/** Reads the session and, when signed in, the allowance, through the injected client. */
export function useAccountState(): AccountState {
  const client = useClient();
  const [state, setState] = useState<AccountState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    const set = (next: AccountState): void => {
      if (!cancelled) setState(next);
    };
    void (async () => {
      const session = await client.session();
      if (!session.signedIn) {
        set({ status: "signed-out" });
        return;
      }
      // The allowance is a convenience on this page; a failed read leaves the rest of it standing.
      const quota = await client.quota().catch(() => undefined);
      set({ status: "ready", email: session.email, quota });
    })().catch(() => set({ status: "failed" }));
    return () => {
      cancelled = true;
    };
  }, [client]);
  return state;
}

/** Ends the session and goes to the landing page, whose call to action is the way back in. */
export function SignOutButton() {
  const client = useClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function signOut(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const result = await client.signOut();
      if (result.ok) {
        navigate(routes.landing);
        return;
      }
      toast(result.error.message);
    } catch {
      toast("Could not sign out. Try again.");
    }
    setBusy(false);
  }
  return (
    <Button size="sm" disabled={busy} onClick={() => void signOut()}>
      Sign out
    </Button>
  );
}

/** Both the account and the network allowance reset with the UTC calendar day on both hosts. */
const RESETS = "Resets 00:00 UTC";

function Allowance({ title, caption, used, limit, note }: { title: string; caption: string; used: number; limit: number; note: string }) {
  return (
    <Panel title={title} actions={<span className="rh-t-caption rh-tone-subtle">{caption}</span>}>
      <div>
        <Text role="heading" figure>
          {used}
        </Text>{" "}
        <span className="rh-tone-subtle">of {limit}</span>
      </div>
      <Meter value={used} max={limit} label={`${title}: ${used} of ${limit} used`} />
      <p className="rh-t-caption rh-tone-subtle">{note}</p>
    </Panel>
  );
}

function Unavailable({ title }: { title: string }) {
  return (
    <Panel title={title}>
      <p className="rh-t-caption rh-tone-subtle">The allowance could not be read just now. Reload the page to try again.</p>
    </Panel>
  );
}

/** Account: who is signed in and what is left of today's allowance. Every figure is what the quota endpoint returned. */
export function AccountScreen({ state }: { readonly state: AccountState }) {
  if (state.status === "loading") {
    return (
      <Page narrow>
        <div role="status" aria-label="Loading your account" className="rh-skeleton-stack">
          <span className="rh-skeleton rh-skeleton-title" />
          <span className="rh-skeleton rh-skeleton-panel" />
        </div>
      </Page>
    );
  }
  if (state.status === "failed") {
    return (
      <Page narrow>
        <Alert tone="err" title="Your account could not be loaded">
          Reload the page to try again.
        </Alert>
      </Page>
    );
  }
  if (state.status === "signed-out") {
    return (
      <Page narrow>
        <EmptyState
          title="You are not signed in"
          action={
            <div className="rh-acct-actions">
              <LinkButton href={routes.signIn}>Sign in</LinkButton>
              <LinkButton href={routes.signUp} variant="primary">
                Create account
              </LinkButton>
            </div>
          }
        >
          Sign in to see how many indexes you have left today.
        </EmptyState>
      </Page>
    );
  }
  const { email, quota } = state;
  const usedAccount = quota === undefined ? 0 : Math.max(0, quota.limitAccount - quota.remainingAccount);
  const usedNetwork = quota === undefined ? 0 : Math.max(0, quota.limitIp - quota.remainingIp);
  return (
    <Page narrow>
      <header className="rh-acct-head">
        <div>
          <Text role="heading" as="h1">
            Account
          </Text>
          {email === undefined ? null : <p className="rh-fg2">{email}</p>}
        </div>
      </header>
      <div className="rh-acct-cols">
        {quota === undefined ? (
          <>
            <Unavailable title="Indexes today" />
            <Unavailable title="Indexes from this network" />
          </>
        ) : (
          <>
            <Allowance
              title="Indexes today"
              caption={RESETS}
              used={usedAccount}
              limit={quota.limitAccount}
              note="An index that fails does not count."
            />
            <Allowance
              title="Indexes from this network"
              caption={RESETS}
              used={usedNetwork}
              limit={quota.limitIp}
              note="Everyone on the same network address shares this allowance."
            />
          </>
        )}
        <Panel title="Limits">
          <KeyValueList
            items={[
              ...(quota === undefined
                ? []
                : [
                    { label: "Each account", value: `${quota.limitAccount} a day` },
                    { label: "Each network", value: `${quota.limitIp} a day` },
                  ]),
              { label: "Repositories", value: "Public, on GitHub" },
              { label: "Languages", value: "Java" },
            ]}
          />
        </Panel>
      </div>
    </Page>
  );
}
