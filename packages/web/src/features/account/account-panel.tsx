"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Gauge, LogIn, LogOut, User, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clientSiteOrigin } from "@/lib/site-origin";
import { QuotaDialog } from "./quota-dialog";
import { refreshSession, useSession } from "./use-session";

const ACTION_BUTTON = "w-full px-2";

/**
 * Sidebar account block, under the theme toggle: a profile row, then two
 * buttons sharing one row. Signed out they open the standalone sign-in and
 * sign-up pages; signed in they open the quota dialog and end the session.
 */
export function AccountPanel() {
  const router = useRouter();
  const session = useSession();
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { Origin: clientSiteOrigin() },
      });
      if (response.ok) {
        await refreshSession();
        router.push("/");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const signedIn = session?.signedIn === true;
  const email = session?.email;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-muted)] text-sm font-medium uppercase text-[var(--color-accent-primary)]"
        >
          {signedIn && email !== undefined ? email.charAt(0) : <User className="h-4 w-4" />}
        </span>
        <div className="min-w-0 text-sm leading-tight">
          <p className="truncate font-medium text-[var(--color-text-primary)]">
            {session === undefined ? " " : signedIn ? (email ?? "Signed in") : "Guest"}
          </p>
          <p className="truncate text-xs text-[var(--color-text-tertiary)]">
            {signedIn ? "Signed in" : "Not signed in"}
          </p>
        </div>
      </div>

      {session === undefined ? (
        <div className="grid grid-cols-2 gap-2" aria-hidden>
          <div className="h-9 animate-pulse rounded-md bg-[var(--color-bg-elevated)]" />
          <div className="h-9 animate-pulse rounded-md bg-[var(--color-bg-elevated)]" />
        </div>
      ) : signedIn ? (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className={ACTION_BUTTON} onClick={() => setQuotaOpen(true)}>
            <Gauge />
            Quota
          </Button>
          <Button type="button" variant="outline" className={ACTION_BUTTON} onClick={() => void signOut()} disabled={busy}>
            <LogOut />
            Sign out
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="outline" className={ACTION_BUTTON}>
            <Link href="/auth/sign-in">
              <LogIn />
              Sign in
            </Link>
          </Button>
          <Button asChild className={ACTION_BUTTON}>
            <Link href="/auth/sign-up">
              <UserPlus />
              Sign up
            </Link>
          </Button>
        </div>
      )}

      <QuotaDialog open={quotaOpen} onOpenChange={setQuotaOpen} />
    </div>
  );
}
