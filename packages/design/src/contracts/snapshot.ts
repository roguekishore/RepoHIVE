/** The pointer to a repository's newest snapshot (`latest.json`). Only `snapshotId` is guaranteed. */
export interface SnapshotPointer {
  readonly snapshotId: string;
  readonly commitSha?: string;
  readonly engineVersion?: string;
  readonly viewsVersion?: string;
  /** ISO-8601 UTC. */
  readonly publishedAt?: string;
}

/** One object a snapshot holds, with the size and SHA-256 of its uncompressed content. */
export interface ManifestFile {
  readonly key: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface SnapshotManifest {
  readonly manifestVersion: number;
  readonly repo: string;
  readonly commitSha: string;
  readonly engineVersion: string;
  readonly viewsVersion: string;
  readonly indexFormatVersion: number;
  readonly files: readonly ManifestFile[];
}

/**
 * Where a repository page stands. A page resolves its snapshot once and keeps it, so a re-index published while it is
 * open cannot mix two snapshots.
 */
export type SnapshotState =
  | { readonly status: "loading" }
  /** No pointer exists: the repository has never been indexed. */
  | { readonly status: "never-indexed" }
  /** The URL named a snapshot that is no longer published. */
  | { readonly status: "expired"; readonly requested: string }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly snapshotId: string;
      readonly source: "latest" | "query";
      readonly commitSha?: string;
    };
