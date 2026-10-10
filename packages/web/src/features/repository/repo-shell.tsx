"use client";

/**
 * The client shell every repository page renders inside. `/repos/<owner>/<repo>/...`
 * is exported once, under placeholder params, so nothing here reads route params:
 * the owner, repo and surface come from the browser path, after mount. The rules
 * the middleware used to apply happen here instead:
 *
 * - an owner or repo GitHub would not allow shows the not-found page;
 * - uppercase letters redirect to the lowercase URL, keeping the rest of the
 *   path and the query;
 * - the bare `/repos/<owner>/<repo>` redirects to the default surface.
 *
 * The provider is keyed by repository, so each repository gets its own snapshot
 * session, and the gate renders a page only once that snapshot is resolved.
 */
import { useEffect, useMemo, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PageTransition } from "@/components/layout/page-transition";
import { PageLoading } from "@/components/shared/page-loading";
import { useMounted } from "@/lib/use-mounted";
import RepoNotFound from "@/app/repos/[owner]/[repo]/not-found";
import { RepoBreadcrumb } from "./repo-breadcrumb";
import { parseRepoPath } from "./repo-name";
import { SnapshotGate } from "./snapshot-gate";
import { SnapshotProvider } from "./snapshot-context";

export function RepoShell({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const pathname = usePathname();
  const router = useRouter();
  const parsed = useMemo(() => (mounted ? parseRepoPath(pathname) : undefined), [mounted, pathname]);
  const redirectTo = parsed?.kind === "ok" ? parsed.redirectTo : undefined;

  useEffect(() => {
    if (redirectTo === undefined) return;
    router.replace(`${redirectTo}${window.location.search}${window.location.hash}`);
  }, [redirectTo, router]);

  if (parsed === undefined) return <PageLoading />;
  if (parsed.kind !== "ok") return <RepoNotFound />;
  if (redirectTo !== undefined) return <PageLoading />;

  return (
    <SnapshotProvider key={parsed.repoId} repoId={parsed.repoId}>
      <RepoBreadcrumb repoId={parsed.repoId} />
      <PageTransition>
        <SnapshotGate>{children}</SnapshotGate>
      </PageTransition>
    </SnapshotProvider>
  );
}
