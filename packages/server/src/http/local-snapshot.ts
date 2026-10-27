import { serveLocalSnapshotPath } from "../hosting/local-snapshots";
import { snapshotObjectKey } from "../hosting/snapshot-objects";

/**
 * `GET /s/<snapshotId>/...`: a published snapshot object, served from the
 * local artifact store in local mode and 404 in hosted mode.
 */

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return serveLocalSnapshotPath(request, path, snapshotObjectKey);
}
