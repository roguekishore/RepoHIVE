"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@repohive/ui/ui/button";
import { clientSiteOrigin } from "@/lib/client/site-origin";

export function SignOutForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { Origin: clientSiteOrigin() },
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        setMessage(body.message ?? "Sign-out failed.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setMessage("Sign-out failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-3 p-6">
      <h1 className="text-lg font-medium">Sign out</h1>
      <p className="text-sm text-[var(--color-text-secondary)]">End your session on this device.</p>
      <Button type="button" onClick={() => void signOut()} disabled={busy}>
        {busy ? "Signing out…" : "Sign out"}
      </Button>
      <p role="status" aria-live="polite" className="text-sm text-[var(--color-error)]">
        {message}
      </p>
    </div>
  );
}
