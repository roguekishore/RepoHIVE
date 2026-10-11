"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, EmptyState, Page, Text } from "../../components/feedback";
import { Button, LinkButton } from "../../components/button";
import { KeyValueList, Panel } from "../../components/panel";
import { Meter, StatusTag } from "../../components/status";
import type { JobList, Quota } from "../../contracts";
import { Icon } from "../../icons/icons";
import { useClient, useNavigate } from "../../provider/design-provider";
import { useToast } from "../../provider/toast";
import { routes } from "../../routes";
import { formatElapsed, formatWhen, repoIdFromJobRepo } from "../dashboard/format";
import { jobStateWord, jobTone } from "../dashboard/job-labels";
import { usageByDay } from "./usage";
import { UsageChart } from "./usage-chart";

/** What the Account page is showing. The shell reads it with {@link useAccountState} and hands it to the screen. */
export type AccountState =
  | { readonly status: "loading" }
  | { readonly status: "signed-out" }
  | { readonly status: "failed" }
  /** `quota` is absent when the allowance could not be read; the page says so rather than guessing. */
  | { readonly status: "ready"; readonly email: string | undefined; readonly quota: Quota | undefined; readonly jobs?: JobList };

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
      // The history and the recent requests are shown only when the job list could be read.
      const jobs = await client.jobs().catch(() => undefined);
      set({ status: "ready", email: session.email, quota, jobs });
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
  return <AccountReady state={state} />;
}

function AccountReady({ state }: { readonly state: Extract<AccountState, { status: "ready" }> }) {
  const { email, quota, jobs } = state;
  const navigate = useNavigate();
  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => (jobs === undefined ? undefined : usageByDay(jobs.items, now)), [jobs, now]);
  const recent = jobs?.items.slice(0, 3) ?? [];
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

      <div className="rh-acct-cols">
        {days === undefined || quota === undefined ? null : (
          <Panel
            title="Indexes, last 14 days"
            className="rh-acct-span"
            actions={
              <Text role="caption" tone="subtle">
                Daily limit shown as a line
              </Text>
            }
          >
            <UsageChart days={days} limit={quota.limitAccount} />
          </Panel>
        )}
        {email === undefined ? null : (
          <Panel title="Profile">
            <KeyValueList items={[{ label: "Email", value: email }]} />
          </Panel>
        )}
      </div>

      {recent.length === 0 ? null : (
        <section className="rh-v-section">
          <div className="rh-v-section-head">
            <Text as="h2" role="title">
              Recent requests
            </Text>
            <LinkButton size="sm" variant="ghost" href={routes.activity}>
              All activity <Icon name="arrow" size={14} />
            </LinkButton>
          </div>
          <div className="rh-panel">
            <div className="rh-table-wrap">
              <table className="rh-table">
                <caption className="rh-sr-only">Recent requests</caption>
                <tbody>
                  {recent.map((job) => (
                    <tr
                      key={job.jobId}
                      className="rh-click"
                      tabIndex={0}
                      onClick={() => navigate(routes.job(job.jobId))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(routes.job(job.jobId));
                        }
                      }}
                    >
                      <td>
                        <span className="rh-v-name">{repoIdFromJobRepo(job.repo)}</span>
                      </td>
                      <td>
                        <StatusTag tone={jobTone(job.state)}>{jobStateWord(job.state)}</StatusTag>
                      </td>
                      <td className="rh-fg3">{formatWhen(job.requestedAt, now)}</td>
                      <td className="rh-n rh-fg3">{job.endedAt === undefined ? "—" : (formatElapsed(job.requestedAt, job.endedAt) ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </Page>
  );
}
