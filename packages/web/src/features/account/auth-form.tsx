"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BrandLogo } from "@/components/shared/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { clientSiteOrigin } from "@/lib/site-origin";
import { refreshSession } from "./use-session";

type AuthMode = "sign-in" | "sign-up";

const COPY = {
  "sign-in": {
    title: "Sign in to your account",
    description: "Enter your email below to sign in to your account",
    submit: "Sign in",
    path: "/api/auth/sign-in",
    switchPrompt: "Don’t have an account?",
    switchLabel: "Sign up",
    switchHref: "/auth/sign-up",
  },
  "sign-up": {
    title: "Create an account",
    description: "Enter your email and a password to get started",
    submit: "Create account",
    path: "/api/auth/sign-up",
    switchPrompt: "Already have an account?",
    switchLabel: "Sign in",
    switchHref: "/auth/sign-in",
  },
} as const;

/** Standalone sign-in / sign-up card, centred on an empty page. */
export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const copy = COPY[mode];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(copy.path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: clientSiteOrigin() },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as { message?: string; code?: string };
      if (!response.ok) {
        setMessage(body.message ?? "The request failed.");
        return;
      }
      await refreshSession();
      router.push("/repos");
      router.refresh();
    } catch {
      setMessage("The request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" className="flex items-center gap-2 self-center text-lg font-semibold tracking-tight">
          <BrandLogo size={28} />
          RepoHIVE
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>{copy.title}</CardTitle>
            <CardDescription>{copy.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label htmlFor={`${mode}-email`} className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id={`${mode}-email`}
                  type="email"
                  placeholder="m@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
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
                {mode === "sign-up" ? (
                  <p className="text-xs text-[var(--color-text-tertiary)]">At least 10 characters.</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-3">
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "Working…" : copy.submit}
                </Button>
                <p role="status" aria-live="polite" className="text-sm text-[var(--color-error)] empty:hidden">
                  {message}
                </p>
                <p className="text-center text-sm text-[var(--color-text-secondary)]">
                  {copy.switchPrompt}{" "}
                  <Link
                    href={copy.switchHref}
                    className="text-[var(--color-text-primary)] underline underline-offset-4 hover:text-[var(--color-accent-primary)]"
                  >
                    {copy.switchLabel}
                  </Link>
                </p>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
