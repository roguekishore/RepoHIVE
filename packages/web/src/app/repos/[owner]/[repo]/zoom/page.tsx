import { redirect } from "next/navigation";

/**
 * Legacy route: the zoom map now lives at `/knowledge-graph` (it replaced the
 * old node-link view under that name). Keep old `/zoom` links working, forwarding
 * a `?focus=` deep-link if present.
 */
export default async function ZoomRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { owner, repo } = await params;
  const { focus } = await searchParams;
  const qs = focus ? `?focus=${encodeURIComponent(focus)}` : "";
  redirect(`/repos/${owner}/${repo}/knowledge-graph${qs}`);
}
