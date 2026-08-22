import { redirect } from "next/navigation";

/**
 * Repo root — lands on the Knowledge Graph, the one Reachable_Surface for the
 * RepoHIVE viewer (spec R9). Overview and the other vendored surfaces are
 * gated out (nav-items.ts), so the root must not route users there.
 */
export default async function RepoRootPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/repos/${id}/knowledge-graph`);
}
