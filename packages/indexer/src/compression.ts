/**
 * Compression and object headers (hosting-2 Requirement 8).
 *
 * Views, manifests and index objects are stored brotli-compressed at quality 9
 * with `Content-Encoding: br` and no `.br` suffix, ready for the CDN to pass
 * through. `latest.json` and `history.json` are stored as-is. Compression runs
 * on the libuv thread pool (`zlib.brotliCompress`, not the sync form), so
 * objects prepared together compress concurrently; the entry points size the
 * pool to the vCPU count. Hashes are always of the uncompressed bytes.
 */
import { brotliCompress, constants } from "node:zlib";
import type { ObjectHeaders } from "./artifact-store.js";
import { sha256Hex } from "./canonical-json.js";
import type { SnapshotObject } from "./layout.js";

export const BROTLI_QUALITY = 9;
export const JSON_CONTENT_TYPE = "application/json";
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const LATEST_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=60";

/** Brotli at quality 9, on the libuv thread pool. */
export function compressBrotli(content: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    brotliCompress(content, { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } }, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

/** The headers an object is stored with, decided by its key's prefix. Throws for a key outside the layout. */
export function headersForKey(key: string): ObjectHeaders {
  if (key.startsWith("s/")) {
    return { contentType: JSON_CONTENT_TYPE, contentEncoding: "br", cacheControl: IMMUTABLE_CACHE_CONTROL };
  }
  if (key.startsWith("idx/")) {
    // Never served; immutable like everything else under a snapshot id.
    return { contentType: JSON_CONTENT_TYPE, contentEncoding: "br", cacheControl: IMMUTABLE_CACHE_CONTROL };
  }
  if (key.startsWith("r/") && key.endsWith("/latest.json")) {
    return { contentType: JSON_CONTENT_TYPE, cacheControl: LATEST_CACHE_CONTROL };
  }
  if (key.startsWith("meta/")) {
    return { contentType: JSON_CONTENT_TYPE };
  }
  throw new RangeError(`headersForKey: key outside the object layout: ${JSON.stringify(key)}`);
}

/** An object ready for `ArtifactStore.put`, with the size and hash of its uncompressed content. */
export interface PreparedObject {
  readonly key: string;
  /** The stored bytes: compressed when `headers.contentEncoding` is `br`. */
  readonly body: Uint8Array;
  readonly headers: ObjectHeaders;
  readonly bytes: number;
  readonly sha256: string;
}

/** Compresses `object` if its key calls for it, and attaches its headers. */
export async function prepareObject(object: SnapshotObject): Promise<PreparedObject> {
  const headers = headersForKey(object.key);
  const body = headers.contentEncoding === "br" ? await compressBrotli(object.content) : object.content;
  return { key: object.key, body, headers, bytes: object.content.byteLength, sha256: sha256Hex(object.content) };
}

/** Prepares every object concurrently; the result keeps the input order. */
export function prepareObjects(objects: readonly SnapshotObject[]): Promise<PreparedObject[]> {
  return Promise.all(objects.map((object) => prepareObject(object)));
}
