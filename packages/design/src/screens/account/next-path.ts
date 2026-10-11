import { routes } from "../../routes";

/**
 * The path a sign-in should return to, from the `next` query value. Only a path on this site counts: it must start with
 * one `/`, so a full URL or a protocol-relative `//host` cannot turn the sign-in page into an open redirect. Control
 * characters and backslashes are refused too: a browser drops a tab or newline from a URL and reads `\` as `/`, so
 * `/<tab>/host` would become `//host`.
 */
export function safeNextPath(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return undefined;
  return value;
}

/** `next` from the address bar, or `undefined`. Call it from an effect or an event: the server render has no address. */
export function readNextPath(): string | undefined {
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

/** A sign-in or sign-up address that returns to `next` afterwards. */
export function withNext(href: string, next: string | undefined): string {
  return next === undefined ? href : `${href}?next=${encodeURIComponent(next)}`;
}

/** The sign-in address that brings a visitor back to the landing's index form, with `repo` filled in. */
export function signInToIndex(repo?: string): string {
  const query = repo === undefined ? "" : `?repo=${encodeURIComponent(repo)}`;
  return withNext(routes.signIn, `${routes.landing}${query}#start`);
}
