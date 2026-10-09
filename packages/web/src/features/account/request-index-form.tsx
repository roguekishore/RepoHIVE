"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { clientSiteOrigin } from "@/lib/site-origin";
import { intakeRejectionMessage } from "@/server/intake/rejection-copy";

interface IndexResponse {
  readonly status?: string;
  readonly jobId?: string;
  readonly snapshotId?: string;
  readonly code?: string;
  readonly message?: string;
  readonly retryAfterSeconds?: number;
}

export function RequestIndexForm({
  initialRepo = "",
  layout = "stacked",
}: {
  initialRepo?: string;
  /** `inline` puts the input and the button on one row, for the dashboard. */
  layout?: "stacked" | "inline";
}) {
  const router = useRouter();
  const [repo, setRepo] = useState(initialRepo);
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatusMessage("Submitting the index request…");
    try {
      const response = await fetch("/api/index", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: clientSiteOrigin() },
        body: JSON.stringify({ repo: repo.trim() }),
      });
      const body = (await response.json()) as IndexResponse;
      if (response.status === 401) {
        setStatusMessage("Sign in to request an index.");
        return;
      }
      if (body.status === "accepted" || body.status === "joined") {
        setStatusMessage("Index accepted. Opening progress…");
        if (body.jobId !== undefined) {
          router.push(`/jobs/${body.jobId}`);
        }
        return;
      }
      if (body.status === "cached") {
        setStatusMessage(`Already indexed (snapshot ${body.snapshotId?.slice(0, 8) ?? ""}).`);
        return;
      }
      if (body.status === "busy") {
        setStatusMessage(
          `The indexer is busy. Try again in ${body.retryAfterSeconds ?? 120} seconds.`,
        );
        return;
      }
      if (body.status === "rejected") {
        setStatusMessage(intakeRejectionMessage(body.code ?? "REJECTED", body.message));
        return;
      }
      setStatusMessage(body.message ?? "The request failed.");
    } catch {
      setStatusMessage("The request failed.");
    } finally {
      setBusy(false);
    }
  }

  const inline = layout === "inline";

  return (
    <form onSubmit={submit} className={inline ? "flex flex-col gap-2" : "flex max-w-md flex-col gap-3"}>
      <div className={inline ? "flex flex-col gap-2 sm:flex-row" : "flex flex-col gap-3"}>
        <div className={inline ? "flex-1" : "flex flex-col gap-1.5"}>
          <label htmlFor="request-repo" className={inline ? "sr-only" : "text-sm font-medium"}>
            Repository
          </label>
          <Input
            id="request-repo"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            placeholder="owner/repo or GitHub URL"
            autoComplete="off"
            required
          />
        </div>
        <Button type="submit" disabled={busy} className={inline ? "sm:w-40" : undefined}>
          {busy ? "Requesting…" : "Request index"}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-[var(--color-text-secondary)] empty:hidden">
        {statusMessage}
      </p>
    </form>
  );
}
