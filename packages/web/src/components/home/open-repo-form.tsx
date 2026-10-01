"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parseRepoParams } from "@/lib/snapshot/repo-name";

/** A plain "open `<owner>/<repo>`" form, until the repository list (a later hosting-3 phase) replaces it. */
export function OpenRepoForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const [owner = "", repo = "", ...rest] = value.trim().replace(/^https?:\/\/github\.com\//, "").split("/");
    const parsed = rest.length === 0 ? parseRepoParams(owner, repo) : ({ kind: "invalid" } as const);
    if (parsed.kind === "invalid") {
      setMessage("Enter a repository as owner/repo.");
      return;
    }
    setMessage("");
    router.push(`/repos/${parsed.repoId}/knowledge-graph`);
  }

  return (
    <form onSubmit={submit} className="mt-6 flex max-w-md flex-col gap-2">
      <label htmlFor="open-repo" className="text-sm font-medium text-[var(--color-text-primary)]">
        Open an indexed repository
      </label>
      <div className="flex gap-2">
        <input
          id="open-repo"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="owner/repo"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-sm hover:bg-[var(--color-bg-elevated)]"
        >
          Open
        </button>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-xs text-[var(--color-error)]">
        {message}
      </p>
    </form>
  );
}
