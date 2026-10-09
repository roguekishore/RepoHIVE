import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";

/**
 * Every page that still has its pre-redesign screen lives in this route group, and the group puts the old navigation
 * frame around it (`AppShell`). The group name is not part of the URL. A screen switches over by deleting its page
 * here and adding the new one in `(own)` or `(bare)` at the same URL; the group empties as the screens move.
 */
export default function LegacyLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
