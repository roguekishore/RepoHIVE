"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Input } from "@repohive/ui/ui/input";
import { Button } from "@repohive/ui/ui/button";
import { clientSiteOrigin } from "@/lib/client/site-origin";

type AuthMode = "sign-in" | "sign-up";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const path = mode === "sign-in" ? "/api/auth/sign-in" : "/api/auth/sign-up";
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: clientSiteOrigin() },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as { message?: string; code?: string };
      if (!response.ok) {
        setMessage(body.message ?? "The request failed.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setMessage("The request failed.");
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "sign-in" ? "Sign in" : "Create an account";

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-lg font-medium text-[var(--color-text-primary)]">{title}</h1>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${mode}-email`} className="text-sm font-medium">
          Email
        </label>
        <Input
          id={`${mode}-email`}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${mode}-password`} className="text-sm font-medium">
          Password
        </label>
        <Input
          id={`${mode}-password`}
          type="password"
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={10}
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Working…" : title}
      </Button>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-[var(--color-error)]">
        {message}
      </p>
    </form>
  );
}
