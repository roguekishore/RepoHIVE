/**
 * Snapshot identity and object layout.
 *
 * Public objects use keys equal to their URL paths (`s/...`, `r/...`), so the
 * CDN needs no rewriting; non-public objects sit under prefixes it never
 * serves (`idx/...`, `meta/...`). Everything under `s/<snapshotId>/` and
 * `idx/<snapshotId>/` is a pure function of the snapshot inputs: the manifest
 * carries no timestamp, and only `latest.json` and `history.json` hold times.
 */
import { canonicalJson, compareBytewise, sha256Hex } from "./canonical-json.js";

// --- Snapshot identity -----------------------------------------------------------

/** What a snapshot id is computed from. */
export interface SnapshotInputs {
  /** `github.com/<owner>/<repo>`, lowercase (see {@link repoKey}). */
  readonly repo: string;
  readonly commitSha: string;
  readonly engineVersion: string;
  readonly viewsVersion: string;
  readonly configDigest: string;
}

const OWNER_PATTERN = /^[A-Za-z0-9-]{1,39}$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const REPO_KEY_PATTERN = /^github\.com\/[a-z0-9-]{1,39}\/[a-z0-9._-]{1,100}$/;
const SNAPSHOT_ID_PATTERN = /^[0-9a-f]{32}$/;

/** True when `owner` and `repo` are GitHub names this service accepts. */
export function isValidRepoName(owner: string, repo: string): boolean {
  return OWNER_PATTERN.test(owner) && REPO_PATTERN.test(repo) && repo !== "." && repo !== "..";
}

/** The canonical `repo` value, `github.com/<owner>/<repo>` in lowercase. Throws on an invalid name. */
export function repoKey(owner: string, repo: string): string {
  if (!isValidRepoName(owner, repo)) {
    throw new RangeError(`repoKey: not a valid GitHub repository name: ${JSON.stringify(`${owner}/${repo}`)}`);
  }
  return `github.com/${owner}/${repo}`.toLowerCase();
}

function assertRepoKey(repo: string): void {
  const name = repo.slice(repo.lastIndexOf("/") + 1);
  if (!REPO_KEY_PATTERN.test(repo) || name === "." || name === "..") {
    throw new RangeError(`not a canonical repo key (github.com/<owner>/<repo>, lowercase): ${JSON.stringify(repo)}`);
  }
}

function assertSnapshotId(snapshotId: string): void {
  if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) {
    throw new RangeError(`not a snapshot id (32 lowercase hex characters): ${JSON.stringify(snapshotId)}`);
  }
}

/**
 * The snapshot id: the first 32 lowercase hex characters of SHA-256 over the
 * canonical JSON of the five inputs (keys sorted byte-wise, no whitespace).
 */
export function snapshotIdOf(inputs: SnapshotInputs): string {
  assertRepoKey(inputs.repo);
  const canonical = canonicalJson({
    repo: inputs.repo,
    commitSha: inputs.commitSha,
    engineVersion: inputs.engineVersion,
    viewsVersion: inputs.viewsVersion,
    configDigest: inputs.configDigest,
  });
  return sha256Hex(canonical).slice(0, 32);
}

// --- Object keys -------------------------------------------------------------------

/** The fixed view files, relative to `s/<snapshotId>/`. */
export const VIEW_FILES = {
  repo: "views/repo.json",
  graph: "views/graph.json",
  adaptivity: "views/adaptivity.json",
  hierarchyScale: "views/hierarchy-scale.json",
  regionDecisions: "views/region-decisions.json",
  zoomMap: "views/zoom-map.json",
  architecture: "views/architecture.json",
  regionDetailIndex: "views/region-detail-index.json",
  blastRadius: "views/blast-radius.json",
} as const;

export type ViewFile = (typeof VIEW_FILES)[keyof typeof VIEW_FILES];

function assertPosition(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`not a 0-based position: ${n}`);
  }
}

/** `s/<snapshotId>/`: every public object of the snapshot. */
export function snapshotPrefix(snapshotId: string): string {
  assertSnapshotId(snapshotId);
  return `s/${snapshotId}/`;
}

/** `s/<snapshotId>/manifest.json`. */
export function manifestKey(snapshotId: string): string {
  return `${snapshotPrefix(snapshotId)}manifest.json`;
}

/** `s/<snapshotId>/<view file>` for one of {@link VIEW_FILES}. */
export function viewKey(snapshotId: string, file: ViewFile): string {
  return `${snapshotPrefix(snapshotId)}${file}`;
}

/** `s/<snapshotId>/views/architecture/<n>.json`, `n` the level's 0-based position in `availableLevels`. */
export function architectureLevelKey(snapshotId: string, n: number): string {
  assertPosition(n);
  return `${snapshotPrefix(snapshotId)}views/architecture/${n}.json`;
}

/** `s/<snapshotId>/views/region-detail/<n>.json`, `n` the region's 0-based position in `metadata.regionDecisions`. */
export function regionDetailKey(snapshotId: string, n: number): string {
  assertPosition(n);
  return `${snapshotPrefix(snapshotId)}views/region-detail/${n}.json`;
}

/** `idx/<snapshotId>/`: the compact index, never served. */
export function indexPrefix(snapshotId: string): string {
  assertSnapshotId(snapshotId);
  return `idx/${snapshotId}/`;
}

/** `idx/<snapshotId>/<fileName>`, with the file name the engine writes. */
export function indexObjectKey(snapshotId: string, fileName: string): string {
  if (fileName.length === 0 || /[/\\]/.test(fileName) || fileName === "." || fileName === "..") {
    throw new RangeError(`not an index file name: ${JSON.stringify(fileName)}`);
  }
  return `${indexPrefix(snapshotId)}${fileName}`;
}

/** `r/github.com/<owner>/<repo>/latest.json`: the public pointer to the current snapshot. */
export function latestKey(repo: string): string {
  assertRepoKey(repo);
  return `r/${repo}/latest.json`;
}

/** `meta/github.com/<owner>/<repo>/history.json`: the pruning record, never served. */
export function historyKey(repo: string): string {
  assertRepoKey(repo);
  return `meta/${repo}/history.json`;
}

// --- JSON documents ------------------------------------------------------------------

/** The bytes of a stored JSON document: `JSON.stringify` with no indentation, UTF-8, no trailing newline. */
export function jsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

/** One object of a snapshot before compression. */
export interface SnapshotObject {
  readonly key: string;
  /** The uncompressed content. */
  readonly content: Uint8Array;
}

export const MANIFEST_VERSION = 1;

/** One manifest entry: the full object key, and the size and SHA-256 of its uncompressed content. */
export interface ManifestFile {
  readonly key: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface Manifest {
  readonly manifestVersion: typeof MANIFEST_VERSION;
  readonly repo: string;
  readonly commitSha: string;
  readonly engineVersion: string;
  readonly viewsVersion: string;
  readonly indexFormatVersion: number;
  /** Sorted by `key`, byte-wise. */
  readonly files: readonly ManifestFile[];
}

export interface ManifestFields {
  readonly repo: string;
  readonly commitSha: string;
  readonly engineVersion: string;
  readonly viewsVersion: string;
  readonly indexFormatVersion: number;
}

/**
 * The snapshot's manifest, listing every given object (the views and the index
 * files; not the manifest itself). Rejects two objects with the same key.
 */
export function buildManifest(fields: ManifestFields, objects: readonly SnapshotObject[]): Manifest {
  assertRepoKey(fields.repo);
  const files = objects
    .map((object) => ({ key: object.key, bytes: object.content.byteLength, sha256: sha256Hex(object.content) }))
    .sort((a, b) => compareBytewise(a.key, b.key));
  for (let i = 1; i < files.length; i += 1) {
    if (files[i]?.key === files[i - 1]?.key) {
      throw new RangeError(`buildManifest: duplicate key ${JSON.stringify(files[i]?.key)}`);
    }
  }
  return {
    manifestVersion: MANIFEST_VERSION,
    repo: fields.repo,
    commitSha: fields.commitSha,
    engineVersion: fields.engineVersion,
    viewsVersion: fields.viewsVersion,
    indexFormatVersion: fields.indexFormatVersion,
    files,
  };
}

export const POINTER_VERSION = 1;

/** `latest.json`: which snapshot a repository currently shows. */
export interface LatestPointer {
  readonly pointerVersion: typeof POINTER_VERSION;
  readonly repo: string;
  readonly snapshotId: string;
  readonly commitSha: string;
  readonly engineVersion: string;
  readonly viewsVersion: string;
  /** ISO-8601 UTC. */
  readonly publishedAt: string;
}

export interface LatestFields {
  readonly repo: string;
  readonly snapshotId: string;
  readonly commitSha: string;
  readonly engineVersion: string;
  readonly viewsVersion: string;
}

export function buildLatest(fields: LatestFields, publishedAt: Date): LatestPointer {
  assertRepoKey(fields.repo);
  assertSnapshotId(fields.snapshotId);
  return {
    pointerVersion: POINTER_VERSION,
    repo: fields.repo,
    snapshotId: fields.snapshotId,
    commitSha: fields.commitSha,
    engineVersion: fields.engineVersion,
    viewsVersion: fields.viewsVersion,
    publishedAt: publishedAt.toISOString(),
  };
}

/** One published snapshot of a repository. */
export interface HistoryEntry {
  readonly snapshotId: string;
  /** ISO-8601 UTC. */
  readonly publishedAt: string;
  /** ISO-8601 UTC, set when a newer snapshot replaced this one in `latest.json`; `null` while current. */
  readonly retiredAt: string | null;
}

/** `history.json`: the repository's snapshots, newest first. */
export interface History {
  readonly snapshots: readonly HistoryEntry[];
}

/**
 * The history after `snapshotId` is published at `publishedAt`: it goes first,
 * current, and every other current entry is retired at `publishedAt`. A
 * snapshot published again moves to the front with the new time instead of
 * appearing twice.
 */
export function recordPublish(previous: History | undefined, snapshotId: string, publishedAt: Date): History {
  assertSnapshotId(snapshotId);
  const at = publishedAt.toISOString();
  const rest = (previous?.snapshots ?? [])
    .filter((entry) => entry.snapshotId !== snapshotId)
    .map((entry) => (entry.retiredAt === null ? { ...entry, retiredAt: at } : entry));
  return { snapshots: [{ snapshotId, publishedAt: at, retiredAt: null }, ...rest] };
}
