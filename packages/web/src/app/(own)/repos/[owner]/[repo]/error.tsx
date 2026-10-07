"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@repohive/design";

/** What a repository page shows when it throws: the same screen as the app's, so the way back is the repositories. */
export default function RepositoryError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorScreen error={error} reset={reset} home="repos" />;
}
