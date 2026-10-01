import { serveLocalSnapshotPath } from "@/lib/hosting/local-snapshots";
import { latestPointerKey } from "@/lib/hosting/snapshot-objects";

/**
 * `GET /r/github.com/<owner>/<repo>/latest.json`: a repository's latest
 * snapshot pointer, served from the local artifact store in local mode and 404
 * in hosted mode.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return serveLocalSnapshotPath(request, path, latestPointerKey);
}
