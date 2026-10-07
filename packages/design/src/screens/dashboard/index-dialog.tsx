"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/button";
import { LabeledInput } from "../../components/field";
import { Modal } from "../../components/modal";
import type { Quota } from "../../contracts";
import { useClient, useLink, useNavigate } from "../../provider/design-provider";
import { useToast } from "../../provider/toast";
import { routes } from "../../routes";

/** `owner/repo` from what a person types or pastes: a bare name, a github.com link, with or without `.git`. */
export function parseRepoInput(text: string): string | undefined {
  const cleaned = text
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cleaned) ? cleaned : undefined;
}

export interface IndexRequestDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialRepo?: string;
}

/**
 * The "Index a repository" dialog. It asks for one repository, sends the request, and follows the answer: a started or
 * joined job opens its page; an already indexed repository opens it; a refusal is explained in the dialog. There is no
 * separate check step, because the server's check is part of the request and nothing answers it ahead of time.
 */
export function IndexRequestDialog({ open, onClose, initialRepo = "" }: IndexRequestDialogProps) {
  const client = useClient();
  const navigate = useNavigate();
  const toast = useToast();
  const Link = useLink();
  const [value, setValue] = useState(initialRepo);
  const [error, setError] = useState<string | undefined>(undefined);
  const [signInNeeded, setSignInNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<Quota | undefined>(undefined);

  useEffect(() => {
    if (!open) return undefined;
    setValue(initialRepo);
    setError(undefined);
    setSignInNeeded(false);
    let cancelled = false;
    client
      .quota()
      .then((next) => {
        if (!cancelled) setQuota(next);
      })
      .catch(() => {
        // The allowance line is a convenience; the dialog works without it.
      });
    return () => {
      cancelled = true;
    };
  }, [open, client, initialRepo]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (value.trim() === "") {
      setError("Enter a repository, for example apache/kafka.");
      return;
    }
    const repo = parseRepoInput(value);
    if (repo === undefined) {
      setError("Use owner/repo or a github.com link, for example apache/kafka.");
      return;
    }
    setError(undefined);
    setSignInNeeded(false);
    setBusy(true);
    try {
      const result = await client.requestIndex(repo);
      switch (result.status) {
        case "accepted":
        case "joined":
          toast(result.status === "accepted" ? "Indexing started" : "Already being indexed");
          onClose();
          navigate(routes.job(result.jobId));
          return;
        case "cached": {
          const [owner = "", name = ""] = repo.split("/");
          toast("Already indexed at the latest commit");
          onClose();
          navigate(routes.repo(owner, name));
          return;
        }
        case "busy":
          setError(`The service is busy. Try again in ${result.retryAfterSeconds} seconds.`);
          return;
        case "rejected":
          setError(result.message);
          setSignInNeeded(result.code === "UNAUTHENTICATED");
          return;
      }
    } catch {
      setError("The request could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const left = quota === undefined ? undefined : quota.remainingAccount;
  return (
    <Modal
      open={open}
      title="Index a repository"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="rh-index-form" disabled={busy}>
            {busy ? "Sending" : "Index repository"}
          </Button>
        </>
      }
    >
      <form id="rh-index-form" noValidate onSubmit={(event) => void submit(event)} className="rh-dash-index-form">
        <LabeledInput
          label="Repository"
          placeholder="owner/repo or https://github.com/owner/repo"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          {...(error === undefined
            ? {
                hint:
                  left === undefined
                    ? "Public GitHub repositories with Java sources."
                    : `Public GitHub repositories with Java sources. You have ${left} of ${quota?.limitAccount ?? left} indexes left today.`,
              }
            : { error })}
        />
        {signInNeeded ? (
          <p className="rh-t-caption">
            <Link href={routes.signIn}>Sign in</Link> to index a repository.
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
