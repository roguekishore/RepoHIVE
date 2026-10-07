import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RepositoryState } from "@/features/host/repository-state";
import { parseRepoParams } from "@/features/repository/repo-name";

interface RepoLayoutProps {
  children: React.ReactNode;
  params: Promise<{ owner: string; repo: string }>;
}

/**
 * The repository layout for the redesigned pages (the old one is in `(legacy)`). The frame, with its repository
 * navigation, comes from the group layout, which reads the repository from the path. This adds the repository's
 * `SnapshotState`, read with `useRepository`. Names GitHub would not allow are a 404, as in the old layout (the
 * middleware answers them first, and redirects uppercase names).
 */
export default async function RepoLayout({ children, params }: RepoLayoutProps) {
  const { owner, repo } = await params;
  const parsed = parseRepoParams(owner, repo);
  if (parsed.kind === "invalid") notFound();
  return (
    <Suspense fallback={null}>
      <RepositoryState key={parsed.repoId} owner={parsed.owner} name={parsed.repo}>
        {children}
      </RepositoryState>
    </Suspense>
  );
}
