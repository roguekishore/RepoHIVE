import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import LegacyNotFound from "./(legacy)/not-found";

/**
 * The 404 for a URL no page matches (and for the middleware's rewrite of a repository name GitHub would not allow).
 * It sits outside every route group, so it brings the old frame itself; pages inside `(legacy)` use that group's own
 * `not-found.tsx`. The new design's 404 replaces both.
 */
export default function RootNotFound() {
  return (
    <Suspense fallback={null}>
      <AppShell>
        <LegacyNotFound />
      </AppShell>
    </Suspense>
  );
}
