"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Button } from "../../components/button";
import { Input } from "../../components/field";
import { useClient, useLink, useNavigate } from "../../provider/design-provider";
import { useToast } from "../../provider/toast";
import { Mark } from "../../icons/mark";
import { routes } from "../../routes";

/**
 * The shortest password both hosts accept (the TS and the Java account services each check it on the server). The page
 * checks it first only to save a round trip; the server stays the authority and its message is shown if it disagrees.
 */
export const PASSWORD_MIN_LENGTH = 10;

export type AuthMode = "sign-in" | "sign-up";

const COPY = {
  "sign-in": {
    title: "Sign in to RepoHIVE",
    submit: "Sign in",
    switchPrompt: "No account?",
    switchLabel: "Create one",
    switchHref: routes.signUp,
    toast: "Signed in",
    autoComplete: "current-password",
  },
  "sign-up": {
    title: "Create a RepoHIVE account",
    submit: "Create account",
    switchPrompt: "Have an account?",
    switchLabel: "Sign in",
    switchHref: routes.signIn,
    toast: "Account created",
    autoComplete: "new-password",
  },
} as const;

/** The shape of an address, not proof it exists: one `@` with something either side and a dot after it. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Field = "email" | "password";

interface Problem {
  readonly field: Field | undefined;
  readonly message: string;
}

function validate(mode: AuthMode, email: string, password: string): Problem | undefined {
  if (!EMAIL_SHAPE.test(email.trim())) {
    return { field: "email", message: "Enter an email address, like name@example.com." };
  }
  if (mode === "sign-up" && password.length < PASSWORD_MIN_LENGTH) {
    return { field: "password", message: `Use at least ${PASSWORD_MIN_LENGTH} characters for the password.` };
  }
  if (password.length === 0) return { field: "password", message: "Enter your password." };
  return undefined;
}

/**
 * Sign in and sign up: one card on an empty page (the bare layout, no app frame). Success goes to the repository list;
 * a signed-in visitor belongs on the dashboard, not on the landing. The account actions come from the injected client.
 */
export function AuthScreen({ mode }: { readonly mode: AuthMode }) {
  const copy = COPY[mode];
  const client = useClient();
  const Link = useLink();
  const navigate = useNavigate();
  const toast = useToast();
  const id = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const errorId = `${id}-error`;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const found = validate(mode, email, password);
    setProblem(found);
    if (found !== undefined) {
      (found.field === "email" ? emailRef : passwordRef).current?.focus();
      return;
    }
    setBusy(true);
    try {
      const credentials = { email: email.trim(), password };
      const result = await (mode === "sign-in" ? client.signIn(credentials) : client.signUp(credentials));
      if (!result.ok) {
        setProblem({ field: undefined, message: result.error.message });
        return;
      }
      toast(copy.toast);
      navigate(routes.repos);
    } catch {
      setProblem({ field: undefined, message: "The request failed. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  const invalid = (field: Field): boolean => problem?.field === field;
  return (
    <div className="rh-auth">
      <div className="rh-auth-card">
        <div className="rh-auth-head">
          <Link href={routes.landing} aria-label="RepoHIVE home">
            <Mark size={32} />
          </Link>
          <h1 className="rh-t-title">{copy.title}</h1>
        </div>
        <form className="rh-auth-form" noValidate onSubmit={(event) => void submit(event)}>
          <label className="rh-auth-label" htmlFor={`${id}-email`}>
            <span>Email</span>
            <Input
              ref={emailRef}
              id={`${id}-email`}
              type="email"
              autoComplete="email"
              value={email}
              invalid={invalid("email")}
              aria-describedby={invalid("email") ? errorId : undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="rh-auth-label" htmlFor={`${id}-password`}>
            <span>Password</span>
            <Input
              ref={passwordRef}
              id={`${id}-password`}
              type="password"
              autoComplete={copy.autoComplete}
              value={password}
              invalid={invalid("password")}
              aria-describedby={invalid("password") ? errorId : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {mode === "sign-up" ? <p className="rh-t-caption rh-tone-subtle">At least {PASSWORD_MIN_LENGTH} characters.</p> : null}
          <p id={errorId} className="rh-t-caption rh-tone-err" role="alert" hidden={problem === undefined}>
            {problem?.message}
          </p>
          <Button type="submit" variant="primary" className="rh-auth-submit" disabled={busy} aria-busy={busy}>
            {copy.submit}
          </Button>
        </form>
        <p className="rh-fg2">
          {copy.switchPrompt} <Link href={copy.switchHref}>{copy.switchLabel}</Link>
        </p>
        <Link href={routes.landing} className="rh-t-caption rh-tone-subtle">
          Back to the home page
        </Link>
      </div>
    </div>
  );
}
