import { redirect } from "next/navigation";

/**
 * Repo root: lands on the Knowledge Graph, the default surface (hosting-3
 * Requirement 3.1). A `?snapshot=` value rides along.
 */
export default async function RepoRootPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ snapshot?: string }>;
}) {
  const { owner, repo } = await params;
  const { snapshot } = await searchParams;
  const qs = snapshot ? `?snapshot=${encodeURIComponent(snapshot)}` : "";
  redirect(`/repos/${owner}/${repo}/knowledge-graph${qs}`);
}
