"use client";

import { useEffect, useState } from "react";

interface QuotaResponse {
  readonly remainingAccount: number;
  readonly remainingIp: number;
  readonly limitAccount: number;
  readonly limitIp: number;
  readonly code?: string;
  readonly message?: string;
}

export function QuotaPanel() {
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
          setData(null);
          return;
        }
        if (!response.ok) {
          setMessage(body.message ?? "Could not load quota.");
          return;
        }
        setData(body);
        setMessage("");
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

  return (
    <div className="mx-auto max-w-md space-y-3 p-6">
      <h1 className="text-lg font-medium">Index quota</h1>
      {data !== null ? (
        <dl className="space-y-2 text-sm" aria-live="polite">
          <div className="flex justify-between gap-4">
            <dt>Remaining for your account today</dt>
            <dd className="font-mono">
              {data.remainingAccount} / {data.limitAccount}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Remaining from your network today</dt>
            <dd className="font-mono">
              {data.remainingIp} / {data.limitIp}
            </dd>
          </div>
        </dl>
      ) : (
        <p role="status" aria-live="polite" className="text-sm text-[var(--color-text-secondary)]">
          {message}
        </p>
      )}
    </div>
  );
}
