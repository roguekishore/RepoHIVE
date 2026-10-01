import { notFound } from "next/navigation";
import { PageTransition } from "@/components/layout/page-transition";
import { RepoBreadcrumb } from "@/components/layout/repo-breadcrumb";
import { SnapshotGate } from "@/components/layout/snapshot-gate";
import { parseRepoParams } from "@/lib/snapshot/repo-name";
import { SnapshotProvider } from "@/lib/snapshot/snapshot-context";

interface RepoLayoutProps {
  children: React.ReactNode;
  params: Promise<{ owner: string; repo: string }>;
}

/**
 * Every repository page lives under `/repos/<owner>/<repo>/...` (hosting-3
 * Requirement 3). Names GitHub would not allow are a 404; uppercase names are
 * redirected to lowercase by the middleware before they reach this layout. The
 * provider is keyed by repository, so each repository gets its own snapshot
 * session, and the gate renders a page only once that snapshot is resolved.
 */
export default async function RepoLayout({ children, params }: RepoLayoutProps) {
  const { owner, repo } = await params;
  const parsed = parseRepoParams(owner, repo);
  if (parsed.kind === "invalid") notFound();
  return (
    <SnapshotProvider key={parsed.repoId} repoId={parsed.repoId}>
      <RepoBreadcrumb repoName={parsed.repoId} />
      <PageTransition>
        <SnapshotGate>{children}</SnapshotGate>
      </PageTransition>
    </SnapshotProvider>
  );
}
