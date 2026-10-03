"use client";

import Link from "next/link";
import { RequestIndexForm } from "@/features/account/request-index-form";
import { useSession } from "@/features/account/use-session";

export function NeverIndexedNotice({ repoId }: { repoId: string }) {
  const signedIn = useSession()?.signedIn ?? null;

  return (
    <div role="status" className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-16 text-center">
      <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">This repository has not been indexed</h1>
      <p className="text-sm text-[var(--color-text-secondary)]">
        <span className="font-mono">{repoId}</span> has no published snapshot yet.
      </p>
      {signedIn === true ? (
        <div className="text-left">
          <RequestIndexForm initialRepo={repoId} />
        </div>
      ) : signedIn === false ? (
        <p className="text-sm">
          <Link href="/auth/sign-in" className="text-[var(--color-accent-primary)] hover:underline">
            Sign in
          </Link>{" "}
          to request an index for this repository, or{" "}
          <Link href="/" className="text-[var(--color-accent-primary)] hover:underline">
            browse indexed repositories
          </Link>
          .
        </p>
      ) : (
        <p aria-live="polite" className="text-sm text-[var(--color-text-secondary)]">
          Checking your session…
        </p>
      )}
    </div>
  );
}
