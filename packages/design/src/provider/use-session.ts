"use client";

import { useEffect, useState } from "react";
import type { Session } from "../contracts";
import { useClient } from "./design-provider";

/**
 * Who is looking at the page: `undefined` while the host answers, then the session. A probe that fails reads as signed
 * out, as the host's own client does, so a page can show the signed-out state without a separate error path.
 */
export function useSession(): Session | undefined {
  const client = useClient();
  const [session, setSession] = useState<Session | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    client
      .session()
      .then((next) => {
        if (!cancelled) setSession(next);
      })
      .catch(() => {
        if (!cancelled) setSession({ signedIn: false });
      });
    return () => {
      cancelled = true;
    };
  }, [client]);
  return session;
}
