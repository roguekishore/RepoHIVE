/**
 * Compression and object headers.
 *
 * Views, manifests and index objects are stored brotli-compressed at quality 9
 * with `Content-Encoding: br` and no `.br` suffix, ready for the CDN to pass
 * through. `history.json` is stored as-is. Compression runs
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

const NAME = /^[a-z0-9._-]{1,100}$/;
const SNAPSHOT_ID = /^[0-9a-f]{32}$/;
const isName = (segment: string | undefined): boolean => segment !== undefined && NAME.test(segment) && segment !== "." && segment !== "..";
const isFile = (segment: string | undefined): boolean => segment !== undefined && segment !== "" && segment !== "." && segment !== "..";

const BROTLI_IMMUTABLE: ObjectHeaders = { contentType: JSON_CONTENT_TYPE, contentEncoding: "br", cacheControl: IMMUTABLE_CACHE_CONTROL };

/**
 * The headers an object is stored with, decided by the exact shape of its key:
 * `artifacts/<o>/<r>/<id>/...` and `private/<o>/<r>/<id>/index/<name>` are brotli JSON cached forever;
 * `private/<o>/<r>/history.json` is plain JSON. Throws for a key outside the layout.
 */
export function headersForKey(key: string): ObjectHeaders {
  const parts = key.split("/");
  if (parts[0] === "artifacts" && parts.length >= 5 && isName(parts[1]) && isName(parts[2]) && SNAPSHOT_ID.test(parts[3] ?? "")) {
    if (parts.slice(4).every(isFile)) {
      return { ...BROTLI_IMMUTABLE };
    }
  }
  if (parts[0] === "private" && isName(parts[1]) && isName(parts[2])) {
    if (parts.length === 6 && SNAPSHOT_ID.test(parts[3] ?? "") && parts[4] === "index" && isFile(parts[5])) {
      // Never served; immutable like everything else under a snapshot id.
      return { ...BROTLI_IMMUTABLE };
    }
    if (parts.length === 4 && parts[3] === "history.json") {
      return { contentType: JSON_CONTENT_TYPE };
    }
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
