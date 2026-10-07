"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@repohive/design";

/** What an app page shows when it throws: inside the frame, with the way back to the repositories. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorScreen error={error} reset={reset} home="repos" />;
}
