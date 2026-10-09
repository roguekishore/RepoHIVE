"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface QuotaResponse {
  readonly remainingAccount: number;
  readonly remainingIp: number;
  readonly limitAccount: number;
  readonly limitIp: number;
  readonly message?: string;
}

function QuotaBody() {
  const [data, setData] = useState<QuotaResponse | null>(null);
  const [message, setMessage] = useState("Loading quota…");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/quota")
      .then(async (response) => {
        const body = (await response.json()) as QuotaResponse;
        if (cancelled) {
          return;
        }
        if (response.status === 401) {
          setMessage("Sign in to see your remaining index requests.");
          return;
        }
        if (!response.ok) {
          setMessage(body.message ?? "Could not load quota.");
          return;
        }
        setData(body);
      })
      .catch(() => {
        if (!cancelled) {
          setMessage("Could not load quota.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (data === null) {
    return (
      <p role="status" aria-live="polite" className="text-sm text-[var(--color-text-secondary)]">
        {message}
      </p>
    );
  }
  return (
    <dl className="space-y-3 text-sm" aria-live="polite">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--color-border-default)] px-4 py-3">
        <dt className="text-[var(--color-text-secondary)]">Your account</dt>
        <dd className="font-mono text-[var(--color-text-primary)]">
          {data.remainingAccount} / {data.limitAccount}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--color-border-default)] px-4 py-3">
        <dt className="text-[var(--color-text-secondary)]">Your network</dt>
        <dd className="font-mono text-[var(--color-text-primary)]">
          {data.remainingIp} / {data.limitIp}
        </dd>
      </div>
    </dl>
  );
}

/** Remaining index requests today. The body mounts per open, so it refetches each time. */
export function QuotaDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Index quota</DialogTitle>
          <DialogDescription>Index requests remaining today.</DialogDescription>
        </DialogHeader>
        <QuotaBody />
      </DialogContent>
    </Dialog>
  );
}
