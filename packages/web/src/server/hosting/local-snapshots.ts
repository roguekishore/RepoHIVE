/**
 * The route-handler side of local snapshot serving: resolves the request path to a
 * store key and serves it from the local artifact store in local mode, and
 * returns 404 in hosted mode, where CloudFront serves these paths.
 */
import { createLocalArtifactStore, type ArtifactStore } from "@repohive/indexer";
import { getAppConfig } from "./config";
import { notFound, serveStoredObject } from "./snapshot-objects";

let store: ArtifactStore | undefined;

/** The local artifact store, or `undefined` in hosted mode. */
function localStore(): ArtifactStore | undefined {
  const config = getAppConfig();
  if (config.mode !== "local" || config.store.kind !== "local") {
    return undefined;
  }
  store ??= createLocalArtifactStore(config.store.directory);
  return store;
}

export async function serveLocalSnapshotPath(
  request: Request,
  segments: readonly string[],
  keyOf: (segments: readonly string[]) => string | undefined,
): Promise<Response> {
  const local = localStore();
  const key = keyOf(segments);
  if (local === undefined || key === undefined) {
    return notFound();
  }
  return serveStoredObject(local, key, request.headers.get("accept-encoding"));
}
