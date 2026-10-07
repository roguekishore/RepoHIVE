"use client";

import { useMemo } from "react";
import { AccountScreen, SignOutButton, useAccountState } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";

/** Loads the session and the allowance, and puts the sign-out button in the frame's header while someone is signed in. */
export function AccountRoute() {
  const state = useAccountState();
  const signedIn = state.status === "ready";
  const actions = useMemo(() => (signedIn ? <SignOutButton /> : undefined), [signedIn]);
  return (
    <PageFrame actions={actions}>
      <AccountScreen state={state} />
    </PageFrame>
  );
}
