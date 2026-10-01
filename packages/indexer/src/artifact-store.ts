/**
 * Storage for published objects. Local
 * implementation: a directory. AWS implementation: one S3 bucket, with no
 * versioning and no object tags.
 *
 * Keys are the layout's object keys (`layout.ts`); bodies are the stored bytes,
 * already compressed where the headers say so (`compression.ts`).
 */

/** The HTTP headers an object is stored with. */
export interface ObjectHeaders {
  readonly contentType: string;
  /** `br` when the body is brotli-compressed; absent when stored as-is. */
  readonly contentEncoding?: "br";
  /** Absent for objects nothing serves (for example `history.json`). */
  readonly cacheControl?: string;
}

/** An object as the store holds it. */
export interface StoredObject {
  readonly body: Uint8Array;
  readonly headers: ObjectHeaders;
}

export interface ArtifactStore {
  /** Writes one object, replacing any object at `key`. */
  put(key: string, body: Uint8Array, headers: ObjectHeaders): Promise<void>;
  /** Reads one object, or `undefined` when there is none at `key`. */
  get(key: string): Promise<StoredObject | undefined>;
  /** Every key that starts with `prefix`, sorted byte-wise. */
  list(prefix: string): Promise<string[]>;
  /** Deletes the given keys; a key with no object is not an error. */
  delete(keys: readonly string[]): Promise<void>;
}
