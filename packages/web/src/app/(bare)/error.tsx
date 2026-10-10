"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@repohive/design";

/** What a page outside the app (the landing, sign in, sign up) shows when it throws. Home is the landing page. */
export default function BareError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorScreen error={error} reset={reset} home="landing" />;
}
