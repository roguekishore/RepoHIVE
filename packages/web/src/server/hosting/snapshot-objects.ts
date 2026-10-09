/**
 * Local serving of the snapshot URLs. In local
 * mode the app answers `/s/<snapshotId>/...` and
 * `/r/github.com/<owner>/<repo>/latest.json` from the local artifact store,
 * with the headers each object was stored with; in hosted mode CloudFront
 * serves them and these paths are 404 from the app.
 *
 * Only the two public prefixes are reachable: `idx/` and `meta/` (and so
 * `history.json`) are never served, as on the CDN.
 *
 * Objects are stored brotli-compressed. A client that does not accept `br`
 * (plain-HTTP clients, test tools) gets the decompressed body instead, without
 * `Content-Encoding`; everything else is the stored headers unchanged.
 */
import { brotliDecompressSync } from "node:zlib";
import { latestKey, type ArtifactStore } from "@repohive/indexer";

const SNAPSHOT_ID = /^[0-9a-f]{32}$/;

function cleanSegments(segments: readonly string[]): boolean {
  return segments.length > 0 && segments.every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\\"));
}

/** The store key behind `/s/<segments...>`, or `undefined` when the path is not a snapshot object. */
export function snapshotObjectKey(segments: readonly string[]): string | undefined {
  const [snapshotId, ...rest] = segments;
  if (snapshotId === undefined || !SNAPSHOT_ID.test(snapshotId) || !cleanSegments(rest)) {
    return undefined;
  }
  return `s/${snapshotId}/${rest.join("/")}`;
}

/** The store key behind `/r/<segments...>`: only `github.com/<owner>/<repo>/latest.json`, canonical lowercase. */
export function latestPointerKey(segments: readonly string[]): string | undefined {
  if (segments.length !== 4 || segments[0] !== "github.com" || segments[3] !== "latest.json") {
    return undefined;
  }
  try {
    return latestKey(`github.com/${segments[1]}/${segments[2]}`);
  } catch {
    return undefined;
  }
}

/** Whether an `Accept-Encoding` value accepts brotli (`br` listed with a non-zero q). */
export function acceptsBrotli(acceptEncoding: string | null): boolean {
  if (acceptEncoding === null) return false;
  return acceptEncoding.split(",").some((part) => {
    const [coding, ...params] = part.trim().toLowerCase().split(";");
    if (coding?.trim() !== "br" && coding?.trim() !== "*") return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}

export function notFound(): Response {
  return Response.json({ code: "NOT_FOUND", message: "Not found." }, { status: 404 });
}

/** The stored object at `key` as an HTTP response, or 404. */
export async function serveStoredObject(store: ArtifactStore, key: string, acceptEncoding: string | null): Promise<Response> {
  const object = await store.get(key);
  if (object === undefined) {
    return notFound();
  }
  const headers = new Headers({ "Content-Type": object.headers.contentType, Vary: "Accept-Encoding" });
  if (object.headers.cacheControl !== undefined) {
    headers.set("Cache-Control", object.headers.cacheControl);
  }
  let body: Uint8Array = object.body;
  if (object.headers.contentEncoding === "br") {
    if (acceptsBrotli(acceptEncoding)) {
      headers.set("Content-Encoding", "br");
    } else {
      body = brotliDecompressSync(object.body);
    }
  }
  headers.set("Content-Length", String(body.byteLength));
  // A copy on its own ArrayBuffer: `BodyInit` does not take a view of a possibly shared buffer.
  return new Response(new Uint8Array(body), { status: 200, headers });
}
