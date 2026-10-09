"use client";

import useSWR, { mutate } from "swr";

export const SESSION_KEY = "/api/auth/session";

export interface SessionState {
  readonly signedIn: boolean;
  readonly email?: string;
}

async function fetchSession(): Promise<SessionState> {
  try {
    const response = await fetch(SESSION_KEY);
    if (!response.ok) {
      return { signedIn: false };
    }
    return (await response.json()) as SessionState;
  } catch {
    return { signedIn: false };
  }
}

/** The signed-in account, or `undefined` while the first probe is in flight. */
export function useSession(): SessionState | undefined {
  return useSWR<SessionState>(SESSION_KEY, fetchSession).data;
}

/** Re-probe after sign-in or sign-out so the sidebar and gates update at once. */
export function refreshSession(): Promise<unknown> {
  return mutate(SESSION_KEY);
}
