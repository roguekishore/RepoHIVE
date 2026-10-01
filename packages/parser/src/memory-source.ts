/**
 * In-memory source (hosting-1 Requirement 5): the same Java sources as a
 * directory, handed over as `{ path, bytes }` entries so a streamed archive can
 * feed the parser with no disk writes.
 *
 * The entries go through the shared selection policy (`source-selection.ts`) and
 * are decoded exactly as a disk read decodes them, so the same tree produces the
 * same graph whichever way it arrives.
 */

import { compareCanonical } from "@repohive/shared";

import { makeError, type ParseError } from "./errors.js";
import {
  classifySourcePath,
  resolveExcludedSegments,
  type SourceSelectionOptions,
} from "./source-selection.js";
import type { CollectedFile } from "./types.js";

/** One source file handed over in memory. */
export interface SourceEntry {
  /**
   * Root-relative POSIX path: forward slashes, no leading `/`, no empty, `.` or
   * `..` segment. Becomes part of node ids, so it is what a directory walk would
   * have produced for the same file.
   */
  path: string;
  /** The file's bytes. Decoded as UTF-8 exactly as a file read is. */
  bytes: Uint8Array;
}

/** What is wrong with a {@link SourceEntry} list, and where. */
export interface SourceEntryProblem {
  /** Index of the offending entry in the list. */
  index: number;
  /** The offending path, when the entry has one. */
  path: string | undefined;
  /** Human-readable reason. */
  problem: string;
}

/**
 * Check a source list for entries no selection policy can make sense of: a path
 * that is not a string, absolute, containing an empty, `.` or `..` segment, using
 * a backslash, or repeating another entry's path; or bytes that are not a
 * `Uint8Array`. Returns the first problem in list order, or `undefined`.
 *
 * Deliberately not about selection: an entry the policy merely drops (a
 * non-`.java` file, an excluded directory) is valid here.
 */
export function findInvalidSourceEntry(
  entries: readonly SourceEntry[],
): SourceEntryProblem | undefined {
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as SourceEntry | undefined;
    if (entry === undefined || entry === null || typeof entry.path !== "string") {
      return { index, path: undefined, problem: "path must be a string" };
    }
    const entryPath = entry.path;
    if (!(entry.bytes instanceof Uint8Array)) {
      return { index, path: entryPath, problem: "bytes must be a Uint8Array" };
    }
    if (entryPath.includes("\\")) {
      return { index, path: entryPath, problem: "path must use forward slashes, not backslashes" };
    }
    if (entryPath.startsWith("/")) {
      return { index, path: entryPath, problem: "path must be relative to the source root, not absolute" };
    }
    for (const segment of entryPath.split("/")) {
      if (segment === "" || segment === "." || segment === "..") {
        return {
          index,
          path: entryPath,
          problem: "path must not contain an empty, \".\" or \"..\" segment",
        };
      }
    }
    if (seen.has(entryPath)) {
      return { index, path: entryPath, problem: "path duplicates an earlier entry" };
    }
    seen.add(entryPath);
  }
  return undefined;
}

/** The outcome of applying the selection policy to a memory source. */
export interface MemorySelection {
  /** Selected files in canonical (byte-wise by path) order. `absolutePath` is the path itself: the key the decoded text is stored under. */
  files: CollectedFile[];
  /**
   * The bytes of every selected file, keyed by `CollectedFile.absolutePath`.
   * Not decoded here: a reader decodes one file at a time with
   * {@link decodeSourceBytes}, so the corpus is never held twice.
   */
  bytes: Map<string, Uint8Array>;
  /** `path-unsupported` errors for `.java` paths that cannot become node ids, in input order. */
  unsupported: ParseError[];
  /**
   * Distinct excluded directories that held at least one entry. A directory
   * walk counts every excluded directory it meets, including empty ones, so
   * this is the memory-side equivalent, not an identical number.
   */
  excludedDirectoryCount: number;
}

/**
 * Decode bytes the way a UTF-8 file read does, including keeping a leading
 * byte-order mark. Goes through the same `Buffer` decoder `readFile(..., "utf8")`
 * uses; a `TextDecoder` would strip the mark by default and change the text.
 */
export function decodeSourceBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
}

/**
 * Apply the shared selection policy to a validated source list. Entries must
 * already have passed {@link findInvalidSourceEntry}.
 */
export function selectMemorySource(
  entries: readonly SourceEntry[],
  options: SourceSelectionOptions = {},
): MemorySelection {
  const excludedSegments = resolveExcludedSegments(options.excludedSegments);
  const files: CollectedFile[] = [];
  const bytes = new Map<string, Uint8Array>();
  const unsupported: ParseError[] = [];
  const excludedDirectories = new Set<string>();

  for (const entry of entries) {
    const kind = classifySourcePath(entry.path, excludedSegments);
    if (kind === "excluded") {
      const segments = entry.path.split("/");
      const first = segments.findIndex((segment, i) => i < segments.length - 1 && excludedSegments.has(segment));
      excludedDirectories.add(segments.slice(0, first + 1).join("/"));
    } else if (kind === "unsupported") {
      unsupported.push(
        makeError(
          "path-unsupported",
          `Java source file path cannot be represented as a portable node identifier: ${entry.path}`,
          entry.path,
        ),
      );
    } else if (kind === "selected") {
      files.push({ absolutePath: entry.path, relativePath: entry.path });
      bytes.set(entry.path, entry.bytes);
    }
  }

  files.sort((a, b) => compareCanonical(a.relativePath, b.relativePath));
  return { files, bytes, unsupported, excludedDirectoryCount: excludedDirectories.size };
}
