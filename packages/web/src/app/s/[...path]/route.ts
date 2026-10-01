import { serveLocalSnapshotPath } from "@/lib/hosting/local-snapshots";
import { snapshotObjectKey } from "@/lib/hosting/snapshot-objects";

/**
 * `GET /s/<snapshotId>/...`: a published snapshot object, served from the
 * local artifact store in local mode and 404 in hosted mode (hosting-3
 * Requirement 1.3).
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return serveLocalSnapshotPath(request, path, snapshotObjectKey);
}
